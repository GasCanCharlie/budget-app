/**
 * Unit tests for Stage 0 — File Acceptance
 *
 * acceptFile() is a hard gate before any DB writes. It checks:
 *   - empty file
 *   - file too large
 *   - unsupported / binary MIME types
 *   - exact duplicate (SHA-256 lookup via prisma)
 *   - truncated CSV (unclosed quoted field at EOF)
 *   - encoding detection + decodedText on success
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock prisma before any imports that reference it ─────────────────────────
vi.mock('@/lib/db', () => ({
  default: {
    upload: {
      findFirst: vi.fn(),
    },
  },
}))

import prisma from '@/lib/db'
import { acceptFile, detectEncoding, decodeBuffer } from '@/lib/ingestion/stage0-acceptance'
import { MAX_FILE_SIZE_BYTES } from '@/types/ingestion'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a plain UTF-8 CSV buffer */
function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8')
}

/** Minimal valid CSV string */
const VALID_CSV = `Date,Description,Amount\n2024-01-15,Coffee shop,-4.50\n2024-01-16,Paycheck,2000.00\n`

// ─────────────────────────────────────────────────────────────────────────────
// detectEncoding (exported helper)
// ─────────────────────────────────────────────────────────────────────────────

describe('detectEncoding', () => {
  it('returns utf-8 for a plain ASCII buffer', () => {
    expect(detectEncoding(Buffer.from('hello'))).toBe('utf-8')
  })

  it('returns utf-8-bom when buffer starts with EF BB BF', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])
    expect(detectEncoding(bom)).toBe('utf-8-bom')
  })

  it('returns utf-16-le when buffer starts with FF FE', () => {
    const bom = Buffer.from([0xff, 0xfe, 0x68, 0x00])
    expect(detectEncoding(bom)).toBe('utf-16-le')
  })

  it('returns utf-16-be when buffer starts with FE FF', () => {
    const bom = Buffer.from([0xfe, 0xff, 0x00, 0x68])
    expect(detectEncoding(bom)).toBe('utf-16-be')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// decodeBuffer (exported helper)
// ─────────────────────────────────────────────────────────────────────────────

describe('decodeBuffer', () => {
  it('decodes plain utf-8 without modification', () => {
    const buf = Buffer.from('hello world', 'utf-8')
    expect(decodeBuffer(buf, 'utf-8')).toBe('hello world')
  })

  it('strips the 3-byte BOM from utf-8-bom content', () => {
    const payload = 'Date,Amount'
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payload, 'utf-8')])
    expect(decodeBuffer(buf, 'utf-8-bom')).toBe(payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// acceptFile
// ─────────────────────────────────────────────────────────────────────────────

describe('acceptFile', () => {
  const findFirstMock = prisma.upload.findFirst as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no existing upload (no duplicate)
    findFirstMock.mockResolvedValue(null)
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('accepts a valid CSV buffer and returns accepted: true', async () => {
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.accepted).toBe(true)
    expect(result.rejectionReason).toBeNull()
    expect(result.sourceType).toBe('CSV')
  })

  it('returns a non-empty fileHash (SHA-256 hex) on success', async () => {
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns decodedText on success', async () => {
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(typeof result.decodedText).toBe('string')
    expect(result.decodedText).toContain('Date')
    expect(result.decodedText).toContain('Coffee shop')
  })

  it('returns the detected encoding on success', async () => {
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.encoding).toBe('utf-8')
  })

  it('correctly identifies encoding as utf-8-bom for BOM-prefixed files', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const buf = Buffer.concat([bom, Buffer.from(VALID_CSV, 'utf-8')])
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.accepted).toBe(true)
    expect(result.encoding).toBe('utf-8-bom')
    // BOM bytes must be stripped from decodedText
    expect(result.decodedText?.startsWith('Date')).toBe(true)
  })

  it('returns fileSize equal to buffer.length', async () => {
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.fileSize).toBe(buf.length)
  })

  // ── Rejection: empty file ───────────────────────────────────────────────────

  it('rejects an empty buffer', async () => {
    const result = await acceptFile(Buffer.alloc(0), 'empty.csv', 'text/csv')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/empty/i)
  })

  // ── Rejection: file too large ───────────────────────────────────────────────

  it('rejects a buffer that exceeds MAX_FILE_SIZE_BYTES', async () => {
    // Allocate one byte over the limit without filling it (saves memory)
    const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1)
    const result = await acceptFile(oversized, 'huge.csv', 'text/csv')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/exceeds/i)
    expect(result.rejectionReason).toMatch(/MB/i)
  })

  it('accepts a buffer exactly at MAX_FILE_SIZE_BYTES (boundary is inclusive)', async () => {
    // Build a minimal valid CSV padded to exactly the size limit with spaces
    const header = 'Date,Description,Amount\n'
    const row    = '2024-01-01,Padding,-1.00\n'
    const base   = Buffer.from(header + row, 'utf-8')
    const pad    = Buffer.alloc(MAX_FILE_SIZE_BYTES - base.length, 0x20) // spaces
    const atLimit = Buffer.concat([base, pad])

    expect(atLimit.length).toBe(MAX_FILE_SIZE_BYTES)

    // This call may succeed or fail on truncation/duplicate checks — we only
    // assert it does NOT fail due to the size limit.
    const result = await acceptFile(atLimit, 'exact-limit.csv', 'text/csv')
    // rejectionReason is null on success, or a non-"exceeds" string on other failures
    const reason = result.rejectionReason ?? ''
    expect(reason).not.toMatch(/exceeds/i)
  })

  // ── Rejection: unsupported MIME / extension ─────────────────────────────────

  it('rejects a file with an unsupported extension and no magic bytes', async () => {
    const buf = csvBuffer('some random text content')
    const result = await acceptFile(buf, 'report.txt', 'text/plain')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/unsupported file type/i)
  })

  it('rejects a file with no extension and no magic bytes', async () => {
    const buf = csvBuffer('no extension here')
    const result = await acceptFile(buf, 'noext', 'application/octet-stream')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/unsupported file type/i)
  })

  it('rejects an XLSX file (magic bytes PK\\x03\\x04) with a Phase 1b message', async () => {
    // XLSX = ZIP: PK\x03\x04 magic bytes
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00])
    const result = await acceptFile(xlsx, 'statement.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/xlsx/i)
    expect(result.rejectionReason).toMatch(/phase 1b/i)
  })

  it('rejects a PDF file (magic bytes %PDF) with a Phase 2 message', async () => {
    // PDF: %PDF = 0x25 0x50 0x44 0x46
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e])
    const result = await acceptFile(pdf, 'statement.pdf', 'application/pdf')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/pdf/i)
    expect(result.rejectionReason).toMatch(/phase 2/i)
  })

  it('rejects a .jpg file', async () => {
    // JPEG magic bytes: FF D8 FF
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
    const result = await acceptFile(jpg, 'photo.jpg', 'image/jpeg')

    expect(result.accepted).toBe(false)
    // JPEG has no magic-byte branch → falls through to extension check
    expect(result.rejectionReason).toMatch(/unsupported file type/i)
  })

  // ── Rejection: duplicate file hash ─────────────────────────────────────────

  it('detects a duplicate when prisma returns an existing upload', async () => {
    findFirstMock.mockResolvedValue({
      id: 'upload-abc-123',
      version: 1,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    })

    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    // Reprocessing is intentionally allowed — duplicate does NOT reject the file.
    expect(result.accepted).toBe(true)
    expect(result.isDuplicate).toBe(true)
    expect(result.existingUploadId).toBe('upload-abc-123')
    // No rejection reason set for duplicates (file is accepted for re-processing).
    expect(result.rejectionReason).toBeNull()
  })

  it('queries prisma with the correct SHA-256 hash', async () => {
    findFirstMock.mockResolvedValue(null)

    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(findFirstMock).toHaveBeenCalledOnce()
    const callArg = findFirstMock.mock.calls[0][0]
    expect(callArg.where.fileHash).toBe(result.fileHash)
  })

  it('sets isDuplicate: false and existingUploadId: null when no duplicate found', async () => {
    findFirstMock.mockResolvedValue(null)

    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'statement.csv', 'text/csv')

    expect(result.isDuplicate).toBe(false)
    expect(result.existingUploadId).toBeNull()
  })

  // ── Rejection: truncated CSV ────────────────────────────────────────────────

  it('rejects a CSV with an unclosed quoted field at EOF', async () => {
    // The opening quote on the last field is never closed
    const truncated = `Date,Description,Amount\n2024-01-15,"Unclosed field,100.00\n`
    const buf = csvBuffer(truncated)
    const result = await acceptFile(buf, 'truncated.csv', 'text/csv')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/truncated/i)
  })

  it('accepts a CSV with a properly escaped double-quote inside a field', async () => {
    // "" inside quotes = escaped literal quote — not a truncation
    const csv = `Date,Description,Amount\n2024-01-15,"He said ""hello""",42.00\n`
    const buf = csvBuffer(csv)
    const result = await acceptFile(buf, 'quoted.csv', 'text/csv')

    expect(result.accepted).toBe(true)
  })

  // ── Extension fallback (no magic bytes) ────────────────────────────────────

  it('accepts a file identified as CSV by .csv extension alone', async () => {
    // Plain text — no XLSX/PDF magic bytes — extension decides
    const buf = csvBuffer(VALID_CSV)
    const result = await acceptFile(buf, 'export.csv', '')

    expect(result.accepted).toBe(true)
    expect(result.sourceType).toBe('CSV')
  })

  it('rejects an .xlsx extension file that also has XLSX magic bytes', async () => {
    // Magic bytes take priority and identify it as XLSX → rejected
    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('fake xlsx content'),
    ])
    const result = await acceptFile(xlsx, 'data.xlsx', 'application/vnd.ms-excel')

    expect(result.accepted).toBe(false)
    expect(result.rejectionReason).toMatch(/xlsx/i)
  })
})
