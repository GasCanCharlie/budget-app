/**
 * Stage 0 — File Acceptance
 *
 * Hard gate before any DB writes. Rejects on:
 *   - empty file
 *   - file too large
 *   - unsupported type (only CSV accepted in Phase 1; XLSX/PDF return clear messages)
 *   - exact duplicate (same SHA-256 of raw bytes, any user)
 *   - truncated CSV (unclosed quoted field at EOF)
 *
 * Produces:
 *   - SHA-256 of raw bytes (stored on Upload for audit / re-verification)
 *   - encoding detection (utf-8 | utf-8-bom | utf-16-le | utf-16-be)
 *   - decoded text string ready for Stage 1
 */

import { createHash } from 'crypto'
import prisma from '@/lib/db'
import type { FileAcceptanceResult } from '@/types/ingestion'
import { MAX_FILE_SIZE_BYTES } from '@/types/ingestion'
import { isOfxFile, detectOfxVariant, sniffIsOfxContent } from './parse-ofx'

// ─── Magic byte detection ────────────────────────────────────────────────────

/**
 * Detect file type from magic bytes.
 * More reliable than MIME type or extension (both can be spoofed/wrong).
 */
function detectTypeFromMagicBytes(buf: Buffer): 'XLSX' | 'PDF' | null {
  // XLSX is a ZIP file: PK signature 0x50 0x4B 0x03 0x04
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'XLSX'
  }
  // PDF: %PDF signature 0x25 0x50 0x44 0x46
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return 'PDF'
  }
  // CSV has no magic bytes — detected by extension fallback
  return null
}

// ─── Encoding detection ──────────────────────────────────────────────────────

/**
 * Detect encoding from BOM bytes.
 * Excel exports commonly produce UTF-8 BOM or UTF-16 LE files.
 */
export function detectEncoding(buf: Buffer): string {
  // UTF-8 BOM: EF BB BF
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom'
  // UTF-16 LE BOM: FF FE
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16-le'
  // UTF-16 BE BOM: FE FF
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16-be'
  return 'utf-8'
}

/**
 * Decode a buffer to string using the detected encoding.
 * BOM bytes are stripped; the returned string contains only content.
 */
export function decodeBuffer(buf: Buffer, encoding: string): string {
  switch (encoding) {
    case 'utf-8-bom':
      return buf.subarray(3).toString('utf-8')
    case 'utf-16-le':
      return buf.subarray(2).toString('utf16le')
    case 'utf-16-be': {
      // Node has no built-in utf-16-be decoder; swap byte pairs, then decode as utf16le
      const body = buf.subarray(2)
      const swapped = Buffer.allocUnsafe(body.length)
      for (let i = 0; i + 1 < body.length; i += 2) {
        swapped[i] = body[i + 1]
        swapped[i + 1] = body[i]
      }
      return swapped.toString('utf16le')
    }
    default:
      return buf.toString('utf-8')
  }
}

// ─── Truncation detection ────────────────────────────────────────────────────

/**
 * Detect a truncated CSV by checking whether any quoted field is left unclosed
 * at end-of-file.  A properly-formed CSV always closes every opened quote.
 */
function checkCsvTruncation(text: string): { valid: boolean; reason: string } {
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (inQuote && i + 1 < text.length && text[i + 1] === '"') {
        i++ // escaped double-quote inside a field — skip both chars
      } else {
        inQuote = !inQuote
      }
    }
  }
  if (inQuote) {
    return {
      valid: false,
      reason: 'File ends inside a quoted field — likely truncated or corrupted during download.',
    }
  }
  return { valid: true, reason: '' }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run Stage 0 acceptance checks on a raw file buffer.
 *
 * This must be called before any DB writes.  If `result.accepted === false`
 * the caller must return an error to the user and abort the pipeline.
 *
 * The returned `fileHash` is the canonical SHA-256 of the raw bytes and must
 * be stored on the Upload record unchanged.
 */
export async function acceptFile(
  buffer: Buffer,
  fileName: string,
  _mimeType: string,
): Promise<FileAcceptanceResult & { decodedText?: string }> {
  const result: FileAcceptanceResult & { decodedText?: string } = {
    accepted: false,
    fileHash: '',
    sourceType: null,
    rejectionReason: null,
    isDuplicate: false,
    previousUploadId: null,
    existingUploadId: null,
    fileSize: buffer.length,
    encoding: null,
  }

  // ── 1. Empty file ─────────────────────────────────────────────────────────
  if (buffer.length === 0) {
    result.rejectionReason = 'File is empty (0 bytes).'
    return result
  }

  // ── 2. Size limit ────────────────────────────────────────────────────────
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    result.rejectionReason =
      `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, which exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB limit.`
    return result
  }

  // ── 3. File type detection ───────────────────────────────────────────────
  //  Priority: magic bytes → extension (MIME type from browser is unreliable)
  const ext = fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    : ''

  const fromMagic = detectTypeFromMagicBytes(buffer)

  // Extension-based type detection
  let sourceType: 'CSV' | 'XLSX' | 'PDF' | 'OFX' | 'QFX' | 'QBO' | null = fromMagic
  if (!sourceType) {
    if (ext === '.csv')                         sourceType = 'CSV'
    else if (ext === '.xlsx' || ext === '.xls') sourceType = 'XLSX'
    else if (ext === '.pdf')                    sourceType = 'PDF'
    else if (ext === '.ofx')                    sourceType = 'OFX'
    else if (ext === '.qfx')                    sourceType = 'QFX'
    else if (ext === '.qbo')                    sourceType = 'QBO'
    else if (isOfxFile(buffer, fileName))       sourceType = 'OFX'
  }

  if (!sourceType) {
    result.rejectionReason =
      `Unsupported file type (extension: "${ext || 'none'}"). Accepted formats: CSV (.csv), OFX (.ofx), QFX (.qfx), QBO (.qbo), Excel (.xlsx), PDF (.pdf).`
    return result
  }

  if (sourceType === 'XLSX') {
    result.rejectionReason =
      'Excel (XLSX) support is coming soon. Please export your bank statement as CSV or OFX/QFX/QBO and re-upload.'
    return result
  }
  if (sourceType === 'PDF') {
    result.rejectionReason =
      'PDF statement parsing is coming in Phase 2. Please export your bank statement as CSV or OFX/QFX/QBO and re-upload.'
    return result
  }

  result.sourceType = sourceType

  // ── 4. SHA-256 of raw bytes ──────────────────────────────────────────────
  //  Hash the bytes BEFORE any decoding so it is stable regardless of how
  //  the caller decodes the text.
  const hash = createHash('sha256').update(buffer).digest('hex')
  result.fileHash = hash

  // ── 5. Global duplicate check ────────────────────────────────────────────
  //  Same SHA-256 → identical file bytes. Reprocessing is ALLOWED: we record
  //  the previous upload id so the route can version-stamp the new record and
  //  mark the old one as superseded.  We do NOT reject here.
  const existingUpload = await prisma.upload.findFirst({
    where: { fileHash: hash },
    orderBy: { createdAt: 'desc' },
    select: { id: true, version: true },
  })
  if (existingUpload) {
    result.isDuplicate = true
    result.previousUploadId = existingUpload.id
    result.existingUploadId = existingUpload.id
    // DO NOT set accepted = false — reprocessing is allowed
  }

  // ── 6. Encoding detection + decode ──────────────────────────────────────
  const encoding = detectEncoding(buffer)
  result.encoding = encoding
  const decodedText = decodeBuffer(buffer, encoding)

  // ── 7. Content sniff — detect mismatch between extension and actual content ──
  //  e.g. a file named ".csv" that actually contains OFX SGML, or vice versa.
  //  We default to the content-detected type and attach a warning.
  const isOfxContent = sniffIsOfxContent(decodedText)
  const extensionImpliesOfx = sourceType === 'OFX' || sourceType === 'QFX' || sourceType === 'QBO'
  const extensionImpliesCsv = sourceType === 'CSV'

  if (extensionImpliesCsv && isOfxContent) {
    // Content looks like OFX but extension says CSV — upgrade to OFX
    result.sourceType         = 'OFX'
    result.contentSniffedType = 'OFX'
    result.formatMismatch     = true
  } else if (extensionImpliesOfx && !isOfxContent) {
    // Extension says OFX family but content doesn't look like it — downgrade to CSV attempt
    result.contentSniffedType = 'CSV'
    result.formatMismatch     = true
    // Keep sourceType as-is; the route will attempt OFX parse and fail gracefully
  }

  // ── 8. Truncation check (CSV only — OFX/QFX/QBO use container tags) ──────
  const finalType = result.sourceType
  if (finalType !== 'OFX' && finalType !== 'QFX' && finalType !== 'QBO') {
    const truncCheck = checkCsvTruncation(decodedText)
    if (!truncCheck.valid) {
      result.rejectionReason = `File appears truncated: ${truncCheck.reason}`
      return result
    }
  }

  result.accepted = true
  result.decodedText = decodedText
  return result
}
