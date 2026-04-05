/**
 * PDF Ingestion Orchestrator
 *
 * Sends PDF directly to Claude via native document API.
 * No text pre-extraction — Claude reads the PDF natively.
 *
 * Flow: classify → llm extract → dedupe → reconcile
 */

import { createHash } from 'crypto'
import { classifyPdf, assertPdfProcessable } from './classify'
import { llmParsePdf } from './llm-parse'
import { reconcileCandidates } from './reconcile'
import type { CandidateTransaction, PdfExtractionResult } from './types'
import { PDF_LIMITS } from './types'

function normalizeForDedup(s: string | null): string {
  if (!s) return ''
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function dedupKey(c: CandidateTransaction): string {
  return [
    c.parsedDate ?? 'nodate',
    c.parsedAmount !== null ? c.parsedAmount.toFixed(2) : 'noamt',
    normalizeForDedup(c.parsedDescription),
  ].join('|||')
}

export async function ingestPdf(
  buffer: Buffer,
  fileName: string,
  uploadId: string,
): Promise<PdfExtractionResult> {
  // ── 1. Classify (basic pre-flight, no pdf-parse) ─────────────────────────
  const classification = classifyPdf(buffer)
  assertPdfProcessable(classification, fileName)

  // ── 2. Stable statement ID ───────────────────────────────────────────────
  const statementId = createHash('sha256')
    .update(`${uploadId}:${fileName}`)
    .digest('hex')
    .slice(0, 16)

  // ── 3. Send PDF directly to Claude ──────────────────────────────────────
  if (buffer.length > PDF_LIMITS.MAX_MODEL_CALLS * 500_000) {
    console.warn(`[pdf/ingest] PDF is large (${(buffer.length / 1024 / 1024).toFixed(1)}MB), proceeding anyway`)
  }

  const allCandidates = await llmParsePdf(buffer, statementId)

  // ── 4. Dedupe ────────────────────────────────────────────────────────────
  const seen = new Map<string, CandidateTransaction>()
  for (const candidate of allCandidates) {
    const key = dedupKey(candidate)
    const existing = seen.get(key)
    if (!existing || candidate.confidence > existing.confidence) {
      seen.set(key, candidate)
    }
  }
  const dedupedCandidates = [...seen.values()]

  // ── 5. Reconcile ─────────────────────────────────────────────────────────
  const reconciliationIssues = reconcileCandidates(dedupedCandidates, classification)

  const hasErrors = reconciliationIssues.some((i) => i.severity === 'error')
  const hasLowConfidence = dedupedCandidates.some((c) => c.confidence < PDF_LIMITS.MIN_CONFIDENCE)
  const reviewRequired = hasErrors || hasLowConfidence

  return {
    candidates: dedupedCandidates,
    classification,
    pageTexts: [],   // Not extracted — Claude handles natively
    reconciliationIssues,
    reviewRequired,
  }
}
