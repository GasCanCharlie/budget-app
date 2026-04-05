/**
 * PDF LLM Extraction
 *
 * Calls Claude API to extract transactions from preprocessed page text chunks.
 * Returns CandidateTransaction[] with provenance metadata.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import type { CandidateTransaction } from './types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Strict schema for model output — what we ask the model to return
interface ExtractedRow {
  rowKey: string
  sourcePage: number
  sourceText: string
  date: string | null          // ISO format YYYY-MM-DD
  description: string | null
  amount: number | null        // always positive
  balance: number | null
  direction: 'debit' | 'credit' | 'unknown'
  confidence: number           // 0–1, model's own estimate
  notes: string[]
}

const EXTRACTION_PROMPT = `You are a precise financial data extractor. Extract ALL transactions from the bank statement text below.

Output ONLY a valid JSON array of transaction objects. No explanation, no markdown, no code blocks — just the raw JSON array.

Each object must have exactly these fields:
{
  "rowKey": "<unique string key for this row, e.g. row_1>",
  "sourcePage": <integer page number from PAGE markers in text>,
  "sourceText": "<verbatim line(s) from the input that produced this transaction>",
  "date": "<YYYY-MM-DD format, or null if not found>",
  "description": "<merchant/payee name and description, or null if not found>",
  "amount": <positive number, or null if not found>,
  "balance": <running balance as positive number, or null if not shown>,
  "direction": "<debit|credit|unknown> — debit=money out, credit=money in",
  "confidence": <0.0 to 1.0 — your confidence this is a real transaction>,
  "notes": ["<any parsing notes or ambiguities>"]
}

Rules:
- amount must ALWAYS be positive — use direction field to indicate sign
- date must be ISO format YYYY-MM-DD
- sourceText must be verbatim from the input (preserve exactly as-is)
- Skip totals, subtotals, and balance-forward rows — those are not transactions
- Skip header rows and footer rows
- If a line is a continuation of the previous transaction, merge it into that transaction's description
- Set confidence < 0.75 if the date, amount, or description is unclear

Text to extract from:
`

/**
 * Validate that a value is a well-formed ExtractedRow array.
 * Returns only the valid rows; logs and drops malformed ones.
 */
function validateExtractedRows(raw: unknown): ExtractedRow[] {
  if (!Array.isArray(raw)) return []

  const valid: ExtractedRow[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>

    // Required: rowKey must be a string
    if (typeof row['rowKey'] !== 'string') continue

    const extracted: ExtractedRow = {
      rowKey: String(row['rowKey']),
      sourcePage: typeof row['sourcePage'] === 'number' ? row['sourcePage'] : 0,
      sourceText: typeof row['sourceText'] === 'string' ? row['sourceText'] : '',
      date: typeof row['date'] === 'string' ? row['date'] : null,
      description: typeof row['description'] === 'string' ? row['description'] : null,
      amount: typeof row['amount'] === 'number' ? Math.abs(row['amount']) : null,
      balance: typeof row['balance'] === 'number' ? row['balance'] : null,
      direction: row['direction'] === 'debit' || row['direction'] === 'credit'
        ? row['direction']
        : 'unknown',
      confidence: typeof row['confidence'] === 'number'
        ? Math.min(1, Math.max(0, row['confidence']))
        : 0.5,
      notes: Array.isArray(row['notes'])
        ? (row['notes'] as unknown[]).filter((n) => typeof n === 'string') as string[]
        : [],
    }

    valid.push(extracted)
  }
  return valid
}

/**
 * Compute basic validity score from parsed fields (0–1).
 * Used to average with the model's self-reported confidence.
 */
function basicValidityScore(row: ExtractedRow): number {
  let score = 0
  let checks = 0

  // Date parsed and valid ISO format
  checks++
  if (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    score++
  }

  // Amount present and positive
  checks++
  if (row.amount !== null && row.amount > 0) score++

  // Description not empty
  checks++
  if (row.description && row.description.trim().length > 0) score++

  // Direction not unknown
  checks++
  if (row.direction !== 'unknown') score++

  return checks > 0 ? score / checks : 0
}

/**
 * Map an ExtractedRow to a CandidateTransaction.
 */
function mapToCandidate(
  row: ExtractedRow,
  statementId: string,
  chunkPageStart: number,
): CandidateTransaction {
  const validityScore = basicValidityScore(row)
  const combinedConfidence = (row.confidence + validityScore) / 2

  const flags: string[] = [...row.notes]
  if (row.direction === 'unknown') flags.push('direction_unknown')
  if (!row.date) flags.push('missing_date')
  if (row.amount === null) flags.push('missing_amount')

  // Stable ID based on content
  const idInput = `${statementId}:${row.sourcePage}:${row.sourceText.slice(0, 80)}`
  const id = createHash('sha256').update(idInput).digest('hex').slice(0, 16)

  return {
    id,
    statementId,
    pageSpan: {
      start: row.sourcePage || chunkPageStart,
      end: row.sourcePage || chunkPageStart,
    },
    sourceLines: row.sourceText ? [row.sourceText] : [],
    rawDate: row.date,
    rawDescription: row.description,
    rawAmount: row.amount !== null ? String(row.amount) : null,
    rawBalance: row.balance !== null ? String(row.balance) : null,
    parsedDate: row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null,
    parsedDescription: row.description,
    parsedAmount: row.amount,
    parsedBalance: row.balance,
    direction: row.direction,
    confidence: combinedConfidence,
    flags,
    extractionMethod: 'llm',
  }
}

/**
 * Call the Claude API to extract transactions from a text chunk.
 *
 * @param chunkText    The preprocessed page text for this chunk
 * @param statementId  Unique ID for this upload/statement (for stable candidate IDs)
 * @param chunkPageStart  1-based page number of the first page in this chunk
 */
export async function llmParseChunk(
  chunkText: string,
  statementId: string,
  chunkPageStart: number,
): Promise<CandidateTransaction[]> {
  const prompt = EXTRACTION_PROMPT + chunkText

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4000,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Extract text content from response
  const content = response.content[0]
  if (content.type !== 'text') {
    console.warn('[pdf/llm-parse] Unexpected response content type:', content.type)
    return []
  }

  const rawText = content.text.trim()

  // Parse the JSON response
  let parsed: unknown
  try {
    // Strip any accidental markdown code fences if model added them
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
    parsed = JSON.parse(jsonText)
  } catch (err) {
    console.warn('[pdf/llm-parse] Failed to parse LLM JSON response:', err)
    console.warn('[pdf/llm-parse] Raw response (first 500 chars):', rawText.slice(0, 500))
    return []
  }

  const rows = validateExtractedRows(parsed)
  return rows.map((row) => mapToCandidate(row, statementId, chunkPageStart))
}
