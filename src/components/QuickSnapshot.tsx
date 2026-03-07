import { Receipt, Store, TrendingUp, Repeat2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StagingTransaction {
  vendorRaw: string
  vendorKey: string
  amountCents: number
  status: 'uncategorized' | 'categorized' | 'needs_review' | 'excluded' | 'transfer'
}

export interface SnapshotData {
  transactionCount: number
  topMerchant: { name: string; total: number } | null
  largestPurchase: number
  subscriptionCount: number
  fewTransactions?: boolean
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
// Sign convention: positive amountCents = expense/debit, negative = credit/income

export function computeSnapshot(transactions: StagingTransaction[]): SnapshotData {
  const active = transactions.filter(tx => tx.status !== 'excluded' && tx.status !== 'transfer')
  const transactionCount = active.length

  // Top merchant by total spend (positive amounts only)
  const merchantMap = new Map<string, { name: string; total: number }>()
  for (const tx of active) {
    if (!tx.vendorKey?.trim() || tx.amountCents <= 0) continue
    const existing = merchantMap.get(tx.vendorKey)
    if (existing) {
      existing.total += tx.amountCents
    } else {
      merchantMap.set(tx.vendorKey, { name: tx.vendorRaw || tx.vendorKey, total: tx.amountCents })
    }
  }
  let topMerchant: { name: string; total: number } | null = null
  for (const entry of merchantMap.values()) {
    if (!topMerchant || entry.total > topMerchant.total) topMerchant = entry
  }

  // Largest single purchase
  let largestPurchase = 0
  for (const tx of active) {
    if (tx.amountCents > largestPurchase) largestPurchase = tx.amountCents
  }

  // Recurring detection: same vendor, 2+ txns, amounts within 10% of each other
  const byVendor = new Map<string, number[]>()
  for (const tx of active) {
    if (!tx.vendorKey?.trim() || tx.amountCents <= 0) continue
    const arr = byVendor.get(tx.vendorKey) ?? []
    arr.push(tx.amountCents)
    byVendor.set(tx.vendorKey, arr)
  }
  let subscriptionCount = 0
  for (const amounts of byVendor.values()) {
    if (amounts.length < 2) continue
    const ref = amounts[0]
    if (amounts.every(a => Math.abs(a - ref) <= ref * 0.1)) subscriptionCount++
  }

  return { transactionCount, topMerchant, largestPurchase, subscriptionCount, fewTransactions: transactionCount < 10 }
}

// ─── Component ────────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export function QuickSnapshot({ data }: { data: SnapshotData }) {
  if (data.fewTransactions) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          We detected <strong style={{ color: 'var(--text)' }}>{data.transactionCount}</strong> transaction{data.transactionCount !== 1 ? 's' : ''} in this statement.
          Categorize them below to unlock insights.
        </p>
      </div>
    )
  }

  const metrics = [
    { icon: Receipt,   label: 'Transactions',     value: String(data.transactionCount),                           detail: null },
    { icon: Store,     label: 'Top Merchant',      value: data.topMerchant?.name ?? 'Top spending merchant',       detail: data.topMerchant ? fmtDollars(data.topMerchant.total) : null },
    { icon: TrendingUp, label: 'Largest Purchase', value: fmtDollars(data.largestPurchase),                        detail: null },
    { icon: Repeat2,   label: 'Subscriptions',     value: String(data.subscriptionCount),                          detail: data.subscriptionCount > 0 ? 'possible recurring' : 'none detected' },
  ]

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 14px' }}>
        Quick Snapshot
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {metrics.map(({ icon: Icon, label, value, detail }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Icon size={15} style={{ color: 'var(--accent)' }} />
            <div>
              <p style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{value}</p>
              {detail && <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{detail}</p>}
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '2px 0 0' }}>{label}</p>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '14px 0 0', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        Categorize transactions below to unlock deeper insights.
      </p>
    </div>
  )
}
