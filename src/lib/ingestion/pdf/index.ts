/**
 * PDF Ingestion Orchestrator
 *
 * Coordinates the full PDF → CandidateTransaction pipeline:
 *   1. Classify
 *   2. Extract pages
 *   3. Preprocess pages
 *   4. Chunk + LLM extract
 *   5. Merge + dedupe candidates
 *   6. Reconcile
 */

import { createHash } from 'crypto'
import { classifyPdf, assertPdfProcessable } from './classify'
import { extractPages } from './extract-pages'
import { preprocessPages } from './preprocess'
import { llmParseChunk } from './llm-parse'
import { reconcileCandidates } from './reconcile'
import type { CandidateTransaction, PdfExtractionResult } from './types'
import { PDF_LIMITS } from './types'

/**
 * Normalize a description for dedup comparison.
 */
function normalizeForDedup(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Build a stable dedup key for a candidate based on date + amount + description.
 */
function dedupKey(c: CandidateTransaction): string {
  return [
    c.parsedDate ?? 'nodate',
    c.parsedAmount !== null ? c.parsedAmount.toFixed(2) : 'noamt',
    normalizeForDedup(c.parsedDescription),
  ].join('|||')
}

/**
 * Main PDF ingestion entry point.
 *
 * @param buffer    Raw PDF file bytes
 * @param fileName  Original filename (for error messages)
 * @param uploadId  Unique upload ID (used for stable candidate IDs)
 */
export async function ingestPdf(
  buffer: Buffer,
  fileName: string,
  uploadId: string,
): Promise<PdfExtractionResult> {
  // ── 1. Classify ──────────────────────────────────────────────────────────
  const classification = await classifyPdf(buffer)

  // Throws with user-friendly message if not processable
  assertPdfProcessable(classification, fileName)

  // ── 2. Extract pages ─────────────────────────────────────────────────────
  const rawPageTexts = await extractPages(buffer)

  // ── 3. Preprocess ────────────────────────────────────────────────────────
  const processedPages = preprocessPages(rawPageTexts)

  // ── 4. Chunk pages (CHUNK_SIZE with OVERLAP_LINES) ────────────────────────
  // Build chunks of CHUNK_SIZE pages, with OVERLAP_LINES lines of overlap
  // between adjacent chunks to catch transactions that span page boundaries.
  const chunks: Array<{ text: string; pageStart: number }> = []

  for (let i = 0; i < processedPages.length; i += PDF_LIMITS.CHUNK_SIZE) {
    const chunkPages = processedPages.slice(i, i + PDF_LIMITS.CHUNK_SIZE)

    let chunkText = chunkPages.join('\n')

    // Add overlap from previous chunk's last OVERLAP_LINES lines
    if (i > 0 && chunks.length > 0) {
      const prevChunkLines = chunks[chunks.length - 1].text.split('\n')
      const overlapLines = prevChunkLines.slice(-PDF_LIMITS.OVERLAP_LINES)
      chunkText = overlapLines.join('\n') + '\n' + chunkText
    }

    chunks.push({
      text: chunkText,
      pageStart: i + 1, // 1-based page number
    })
  }

  // ── 5. LLM extraction (respect MAX_MODEL_CALLS limit) ────────────────────
  const statementId = createHash('sha256')
    .update(`${uploadId}:${fileName}`)
    .digest('hex')
    .slice(0, 16)

  const allCandidates: CandidateTransaction[] = []
  const callCount = Math.min(chunks.length, PDF_LIMITS.MAX_MODEL_CALLS)

  if (chunks.length > PDF_LIMITS.MAX_MODEL_CALLS) {
    console.warn(
      `[pdf/ingest] PDF has ${chunks.length} chunks but MAX_MODEL_CALLS is ${PDF_LIMITS.MAX_MODEL_CALLS}. ` +
      `Processing first ${PDF_LIMITS.MAX_MODEL_CALLS} chunks only.`,
    )
  }

  for (let i = 0; i < callCount; i++) {
    const chunk = chunks[i]
    try {
      const candidates = await llmParseChunk(
        chunk.text,
        statementId,
        chunk.pageStart,
      )
      allCandidates.push(...candidates)
    } catch (err) {
      console.error(`[pdf/ingest] LLM parse failed for chunk ${i + 1}:`, err)
      // Continue with next chunk rather than failing the whole upload
    }
  }

  // ── 6. Merge + dedupe candidates ─────────────────────────────────────────
  // Dedupe by (date + amount + description normalized).
  // When duplicates exist (from chunk overlap), keep the one with higher confidence.
  const seen = new Map<string, CandidateTransaction>()

  for (const candidate of allCandidates) {
    const key = dedupKey(candidate)
    const existing = seen.get(key)
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(key, candidate)
    }
  }

  const dedupedCandidates = [...seen.values()]

  // ── 7. Reconcile ─────────────────────────────────────────────────────────
  const reconciliationIssues = reconcileCandidates(dedupedCandidates, classification)

  // Review is required if any candidates are low confidence or have errors
  const hasErrors = reconciliationIssues.some((i) => i.severity === 'error')
  const hasLowConfidence = dedupedCandidates.some(
    (c) => c.confidence < PDF_LIMITS.MIN_CONFIDENCE,
  )
  const reviewRequired = hasErrors || hasLowConfidence

  return {
    candidates: dedupedCandidates,
    classification,
    pageTexts: rawPageTexts,
    reconciliationIssues,
    reviewRequired,
  }
}
