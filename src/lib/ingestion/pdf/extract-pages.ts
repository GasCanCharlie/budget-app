/**
 * PDF Page Extraction
 *
 * Extracts text per page from a PDF buffer, strips repeated headers/footers,
 * and adds page boundary markers.
 */

import { PDFParse } from 'pdf-parse'

/**
 * Extract text content from each page of a PDF buffer.
 * Returns one string per page, with page boundary markers prepended.
 * Repeated lines (appearing identically on 3+ pages) are stripped as headers/footers.
 */
export async function extractPages(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: buffer })
  const textResult = await parser.getText()
  await parser.destroy()

  const pages = textResult.pages

  // Split each page text into lines for header/footer detection
  const perPageLines: string[][] = pages.map((p) =>
    p.text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0),
  )

  // Strip repeated headers/footers: lines appearing identically on 3+ pages
  const lineFrequency = new Map<string, number>()
  for (const lines of perPageLines) {
    // Only check first and last 5 lines of each page (header/footer zones)
    const candidates = [...lines.slice(0, 5), ...lines.slice(-5)]
    const uniqueCandidates = new Set(candidates.filter((l) => l.trim().length > 0))
    for (const line of uniqueCandidates) {
      lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1)
    }
  }

  // Lines appearing on 3+ pages are boilerplate
  const boilerplate = new Set(
    [...lineFrequency.entries()]
      .filter(([, count]) => count >= 3)
      .map(([line]) => line),
  )

  // Build final page texts with boundary markers
  const result: string[] = []
  for (let i = 0; i < perPageLines.length; i++) {
    const pageNum = pages[i]?.num ?? i + 1
    const filtered = perPageLines[i].filter((line) => !boilerplate.has(line))
    const cleaned = filtered.join('\n').trim()
    result.push(`\n--- PAGE ${pageNum} ---\n${cleaned}`)
  }

  return result
}
