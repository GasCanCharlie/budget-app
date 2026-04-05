/**
 * PDF LLM Extraction
 *
 * Sends the PDF buffer directly to Claude via the native document API.
 * No text pre-extraction needed — Claude reads the PDF natively.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { createHash } from 'crypto'
import type { CandidateTransaction } from './types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ExtractedRow {
  rowKey: string
  sourcePage: number
  sourceText: string
  date: string | null
  description: string | null
  amount: number | null
  balance: number | null
  direction: 'debit' | 'credit' | 'unknown'
  confidence: number
  notes: string[]
}

const EXTRACTION_PROMPT = `You are a precise financial data extractor. Extract ALL transactions from this bank statement PDF.

Output ONLY a valid JSON array of transaction objects. No explanation, no markdown, no code blocks — just the raw JSON array.

Each object must have exactly these fields:
{
  "rowKey": "<unique string key, e.g. row_1>",
  "sourcePage": <integer page number>,
  "sourceText": "<verbatim text from the statement that produced this transaction>",
  "date": "<YYYY-MM-DD format, or null if not found>",
  "description": "<merchant or payee name and description, or null>",
  "amount": <positive number, or null>,
  "balance": <running balance as positive number, or null if not shown>,
  "direction": "<debit|credit|unknown> — debit=money out, credit=money in",
  "confidence": <0.0 to 1.0>,
  "notes": ["<any parsing notes or ambiguities>"]
}

Rules:
- amount must ALWAYS be positive — use direction field for sign
- date must be ISO format YYYY-MM-DD
- Skip totals, subtotals, balance-forward rows, headers, and footers
- If a description spans multiple lines, merge into one transaction
- Set confidence < 0.75 if date, amount, or description is unclear`

function validateExtractedRows(raw: unknown): ExtractedRow[] {
  if (!Array.isArray(raw)) return []

  const valid: ExtractedRow[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    if (typeof row['rowKey'] !== 'string') continue

    valid.push({
      rowKey: String(row['rowKey']),
      sourcePage: typeof row['sourcePage'] === 'number' ? row['sourcePage'] : 1,
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
        ? (row['notes'] as unknown[]).filter((n): n is string => typeof n === 'string')
        : [],
    })
  }
  return valid
}

function basicValidityScore(row: ExtractedRow): number {
  let score = 0
  if (row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) score++
  if (row.amount !== null && row.amount > 0) score++
  if (row.description && row.description.trim().length > 0) score++
  if (row.direction !== 'unknown') score++
  return score / 4
}

function mapToCandidate(row: ExtractedRow, statementId: string): CandidateTransaction {
  const validityScore = basicValidityScore(row)
  const combinedConfidence = (row.confidence + validityScore) / 2

  const flags: string[] = [...row.notes]
  if (row.direction === 'unknown') flags.push('direction_unknown')
  if (!row.date) flags.push('missing_date')
  if (row.amount === null) flags.push('missing_amount')

  const id = createHash('sha256')
    .update(`${statementId}:${row.sourcePage}:${row.sourceText.slice(0, 80)}`)
    .digest('hex')
    .slice(0, 16)

  return {
    id,
    statementId,
    pageSpan: { start: row.sourcePage, end: row.sourcePage },
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
 * Send the entire PDF buffer to Claude as a native document and extract transactions.
 */
export async function llmParsePdf(
  buffer: Buffer,
  statementId: string,
): Promise<CandidateTransaction[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: buffer.toString('base64'),
            },
          } as ContentBlockParam,
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          } as ContentBlockParam,
        ],
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    console.warn('[pdf/llm-parse] Unexpected response content type:', content.type)
    return []
  }

  const rawText = content.text.trim()

  let parsed: unknown
  try {
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
    parsed = JSON.parse(jsonText)
  } catch (err) {
    console.warn('[pdf/llm-parse] Failed to parse JSON response:', err)
    console.warn('[pdf/llm-parse] Raw response (first 500 chars):', rawText.slice(0, 500))
    return []
  }

  const rows = validateExtractedRows(parsed)
  return rows.map((row) => mapToCandidate(row, statementId))
}
