import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads/[id]/scan-report/pdf
// Generates and streams a PDF version of the scan report.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const styles = StyleSheet.create({
  page:        { padding: 40, fontSize: 10, fontFamily: 'Helvetica', backgroundColor: '#ffffff', color: '#1a1a2e' },
  header:      { marginBottom: 24 },
  title:       { fontSize: 22, fontWeight: 'bold', marginBottom: 4, color: '#1e3a5f' },
  subtitle:    { fontSize: 10, color: '#666' },
  section:     { marginBottom: 18 },
  sectionTitle:{ fontSize: 13, fontWeight: 'bold', marginBottom: 8, color: '#1e3a5f', borderBottomWidth: 1, borderBottomColor: '#dde', paddingBottom: 4 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  label:       { color: '#444', flex: 1 },
  value:       { fontWeight: 'bold', color: '#1a1a2e' },
  statRow:     { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statBox:     { flex: 1, padding: 10, backgroundColor: '#f4f6fa', borderRadius: 6 },
  statLabel:   { fontSize: 8, color: '#888', marginBottom: 2, textTransform: 'uppercase' },
  statValue:   { fontSize: 14, fontWeight: 'bold', color: '#1e3a5f' },
  summaryBox:  { backgroundColor: '#f0f4ff', padding: 12, borderRadius: 6, marginBottom: 16 },
  summaryText: { fontSize: 10, lineHeight: 1.6, color: '#333' },
  badge:       { fontSize: 8, padding: '2 6', borderRadius: 10, backgroundColor: '#e8f0fe', color: '#3b5bdb', alignSelf: 'flex-start', marginBottom: 6 },
  footer:      { position: 'absolute', bottom: 30, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#aaa' },
})

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true, filename: true, createdAt: true },
  })
  if (!upload) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ── Aggregate report data ──────────────────────────────────────────────────
  const [transactions, ingestionIssues, anomalies, subscriptions] = await Promise.all([
    prisma.transaction.findMany({
      where: { uploadId: params.id, account: { userId: payload.userId } },
      select: { merchantNormalized: true, amount: true, appCategory: true, isPossibleDuplicate: true, date: true, bankFingerprint: true },
    }),
    prisma.ingestionIssue.findMany({
      where: { transaction: { uploadId: params.id } },
      select: { severity: true, description: true, issueType: true },
    }),
    prisma.anomalyAlert.findMany({
      where: { userId: payload.userId, isDismissed: false },
      select: { message: true, alertType: true },
      take: 10,
    }),
    prisma.subscriptionCandidate.findMany({
      where: { userId: payload.userId, recurringConfidence: { not: 'low' }, subscriptionScore: { gte: 40 }, isSuppressed: false },
      select: { merchantNormalized: true, estimatedMonthlyAmount: true, recurringConfidence: true },
      orderBy: { estimatedMonthlyAmount: 'desc' },
      take: 10,
    }),
  ])

  const income   = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const spending = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const net      = income - spending

  const duplicates = transactions.filter(t => t.isPossibleDuplicate)

  const merchantMap = new Map<string, { total: number; count: number }>()
  for (const t of transactions) {
    if (t.amount < 0 && t.merchantNormalized) {
      const k = t.merchantNormalized
      const e = merchantMap.get(k) ?? { total: 0, count: 0 }
      merchantMap.set(k, { total: e.total + Math.abs(t.amount), count: e.count + 1 })
    }
  }
  const topMerchants = [...merchantMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)
    .map(([merchant, { total, count }]) => ({ merchant, total, count }))

  const catMap = new Map<string, number>()
  for (const t of transactions) {
    if (t.amount < 0 && t.appCategory) {
      catMap.set(t.appCategory, (catMap.get(t.appCategory) ?? 0) + Math.abs(t.amount))
    }
  }
  const categories = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, total]) => ({ cat, total, pct: spending > 0 ? Math.round((total / spending) * 100) : 0 }))

  const issueCount = { high: 0, medium: 0, low: 0 }
  for (const i of ingestionIssues) {
    if (i.severity === 'HIGH') issueCount.high++
    else if (i.severity === 'MEDIUM') issueCount.medium++
    else issueCount.low++
  }

  const subTotal = subscriptions.reduce((s, sub) => s + sub.estimatedMonthlyAmount, 0)
  const generatedAt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Statement Scan Report</Text>
          <Text style={styles.subtitle}>{upload.filename} · Generated {generatedAt} · BudgetLens</Text>
        </View>

        {/* Totals */}
        <View style={styles.statRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Income</Text>
            <Text style={[styles.statValue, { color: '#2e7d32' }]}>{fmt(income)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Spending</Text>
            <Text style={[styles.statValue, { color: '#c62828' }]}>{fmt(spending)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Net</Text>
            <Text style={[styles.statValue, { color: net >= 0 ? '#2e7d32' : '#c62828' }]}>{fmt(net)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Transactions</Text>
            <Text style={styles.statValue}>{transactions.length}</Text>
          </View>
        </View>

        {/* Flags */}
        {(duplicates.length > 0 || anomalies.length > 0 || issueCount.high > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚠ Flags & Alerts</Text>
            {duplicates.length > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>Possible duplicate charges</Text>
                <Text style={styles.value}>{duplicates.length}</Text>
              </View>
            )}
            {anomalies.map((a, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>{a.message}</Text>
                <Text style={styles.value}>{a.alertType}</Text>
              </View>
            ))}
            {issueCount.high > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>High-severity ingestion issues</Text>
                <Text style={[styles.value, { color: '#c62828' }]}>{issueCount.high}</Text>
              </View>
            )}
          </View>
        )}

        {/* Subscriptions */}
        {subscriptions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recurring Charges — {fmt(subTotal)}/mo · {fmt(subTotal * 12)}/yr</Text>
            {subscriptions.map((s, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>{s.merchantNormalized}</Text>
                <Text style={styles.value}>{fmt(s.estimatedMonthlyAmount)}/mo</Text>
              </View>
            ))}
          </View>
        )}

        {/* Top Merchants */}
        {topMerchants.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Merchants by Spend</Text>
            {topMerchants.map((m, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>{m.merchant} ({m.count} transactions)</Text>
                <Text style={styles.value}>{fmt(m.total)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Category Breakdown */}
        {categories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Spending by Category</Text>
            {categories.map((c, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.label}>{c.cat || 'Uncategorized'}</Text>
                <Text style={styles.value}>{fmt(c.total)} ({c.pct}%)</Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>BudgetLens — Statement Intelligence</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

      </Page>
    </Document>
  )

  const buffer = await renderToBuffer(doc)

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="scan-report-${params.id.slice(0, 8)}.pdf"`,
      'Content-Length':      String(buffer.length),
    },
  })
}
