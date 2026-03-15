'use client'

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { Repeat2, Zap, Loader2, Landmark, Play, Tag, Shield, BookOpen, ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Commitment {
  id: string
  merchantNormalized: string
  estimatedMonthlyAmount: number
  recurringConfidence: string
  consecutiveMonths: number
  serviceCategory: string | null
  estimatedNextCharge: string | null
  subscriptionScore: number
}

type CommitmentType = 'loan' | 'utility' | 'streaming' | 'membership' | 'insurance' | 'other'

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<CommitmentType, {
  label: string
  icon: LucideIcon
  color: string
  bg: string
}> = {
  loan:       { label: 'Loans & Financing',    icon: Landmark, color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
  utility:    { label: 'Utilities & Services', icon: Zap,      color: '#06B6D4', bg: 'rgba(6,182,212,0.12)'   },
  streaming:  { label: 'Streaming & Apps',     icon: Play,     color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  membership: { label: 'Memberships',          icon: Tag,      color: '#6366F1', bg: 'rgba(99,102,241,0.12)'  },
  insurance:  { label: 'Insurance',            icon: Shield,   color: '#10B981', bg: 'rgba(16,185,129,0.12)'  },
  other:      { label: 'Other Recurring',      icon: Repeat2,  color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)' },
}

const TYPE_ORDER: CommitmentType[] = ['loan', 'utility', 'streaming', 'membership', 'insurance', 'other']

// Confidence → human label + color. Neutral colors — confirmed doesn't mean good.
const CONF_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: 'Confirmed', color: '#86EFAC', bg: 'rgba(134,239,172,0.10)' },
  medium: { label: 'Likely',    color: '#FCD34D', bg: 'rgba(252,211,77,0.10)'  },
  low:    { label: 'Possible',  color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)' },
}

// Canonical display names for well-known merchants
const DISPLAY_OVERRIDES: Record<string, string> = {
  'verizon wireless':   'Verizon Wireless',
  'verizon':            'Verizon',
  'spectrum':           'Spectrum',
  'youtube':            'YouTube',
  'youtube premium':    'YouTube Premium',
  'amazon prime':       'Amazon Prime',
  'amazon':             'Amazon',
  'netflix':            'Netflix',
  'spotify':            'Spotify',
  'hulu':               'Hulu',
  'disney plus':        'Disney+',
  'disney':             'Disney+',
  'apple':              'Apple',
  'apple tv':           'Apple TV+',
  'google':             'Google',
  'google one':         'Google One',
  'at&t':               'AT&T',
  'att':                'AT&T',
  'tmobile':            'T-Mobile',
  't mobile':           'T-Mobile',
  'geico':              'GEICO',
  'usaa':               'USAA',
  'paypal':             'PayPal',
  'hbo':                'HBO / Max',
  'hbo max':            'HBO Max',
  'paramount':          'Paramount+',
  'peacock':            'Peacock',
}

// ─── Normalization (mirrors detect-subscriptions.ts — applied UI-side too    ─
// so pre-fix DB data also deduplicates correctly)                             ─

function normalizeKeyUI(raw: string): string {
  let s = (raw || '').toLowerCase().trim()
  s = s.replace(
    /^(payment to|payments to|transfer to|ach payment to?|ach pmt|online pmt|online payment|pymt to|pmt to|bill pmt|bill payment|web pmnt|autopay|recurring pmt|scheduled pmt|checkcard|pos purchase|pos debit)\s+/,
    ''
  )
  s = s.replace(/\s+(payment|pymt|pmt|autopay|billpay)$/, '')
  s = s.replace(/[^\w\s-]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function cleanDisplayName(rawMerchant: string): string {
  const key = normalizeKeyUI(rawMerchant)
  if (DISPLAY_OVERRIDES[key]) return DISPLAY_OVERRIDES[key]
  return key.replace(/\b\w/g, c => c.toUpperCase())
}

function classifyCommitment(key: string, serviceCategory: string | null): CommitmentType {
  const k = normalizeKeyUI(key)

  if (/\b(loan|mort|bankoh|bnkoh|credit union|financing|lender|finance|lendin|capita|fcu|hfcu)\b/.test(k))
    return 'loan'

  if (/\b(spectrum|verizon|at&t|att|tmobile|t-mobile|t mobile|comcast|cox|xfinity|electric|power|water|sewer|gas co|utility|internet|cable|wireless|cellular|centurylink|frontier|hawaiian tel|meco|helco|hawaiian electric)\b/.test(k))
    return 'utility'

  if (/\b(netflix|hulu|youtube|disney|spotify|apple tv|amazon prime|peacock|paramount|max|hbo|sling|fubo|tidal|pandora|audible|prime video|appletv|crunchyroll|dazn)\b/.test(k))
    return 'streaming'

  if (/\b(gym|fitness|planet fitness|car wash|wash|costco|sam.?s|membership|club|association|anytime|equinox|ymca|crossfit|amazon|apple|google one)\b/.test(k))
    return 'membership'

  if (/\b(insurance|insur|geico|allstate|state farm|progressive|nationwide|usaa|aaa|travelers|liberty mutual|farmers|hartford)\b/.test(k))
    return 'insurance'

  if (serviceCategory) {
    const sc = serviceCategory.toLowerCase()
    if (sc.includes('loan') || sc.includes('mortgage')) return 'loan'
    if (sc.includes('utility') || sc.includes('phone') || sc.includes('internet') || sc.includes('cable')) return 'utility'
    if (sc.includes('entertainment') || sc.includes('streaming')) return 'streaming'
    if (sc.includes('membership') || sc.includes('subscription')) return 'membership'
    if (sc.includes('insurance')) return 'insurance'
  }

  return 'other'
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtAmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const fmtWhole = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function fmtDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfBadge({ conf }: { conf: string }) {
  const cfg = CONF_CONFIG[conf] ?? CONF_CONFIG.low
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      fontSize: 10, fontWeight: 700, borderRadius: 6,
      padding: '2px 7px', letterSpacing: '0.04em',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  )
}

function CommitmentRow({ item }: { item: Commitment & { commitmentType: CommitmentType } }) {
  const { icon: Icon, color, bg } = TYPE_CONFIG[item.commitmentType]
  const nextDate = fmtDate(item.estimatedNextCharge)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 14px',
      background: 'var(--surface2, rgba(255,255,255,0.03))',
      borderRadius: 10,
      border: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
    }}>
      {/* Type icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={14} style={{ color }} />
      </div>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #E5E7EB)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {cleanDisplayName(item.merchantNormalized)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted, #6B7280)', marginTop: 2, display: 'flex', gap: 6 }}>
          <span>{item.consecutiveMonths} mo detected</span>
          {nextDate && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>Next ~{nextDate}</span>
            </>
          )}
        </div>
      </div>

      {/* Amount + confidence */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #E5E7EB)',
          fontVariantNumeric: 'tabular-nums', marginBottom: 4,
        }}>
          {fmtAmt(item.estimatedMonthlyAmount)}<span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted, #6B7280)', marginLeft: 2 }}>/mo</span>
        </div>
        <ConfBadge conf={item.recurringConfidence} />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SubscriptionPanel({ userId }: { userId: string | undefined }) {
  const { apiFetch } = useApi()
  const router = useRouter()

  const { data, isLoading } = useQuery<{ subscriptions: Commitment[]; hasRules: boolean }>({
    queryKey: ['subscriptions'],
    queryFn: () => apiFetch('/api/subscriptions'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  })

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border-soft)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={16} style={{ color: '#6366F1', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Scanning for recurring payments…</span>
      </div>
    )
  }

  // ── No rules set up yet ──────────────────────────────────────────────────────
  if (!data?.hasRules) return (
    <div style={{
      background: 'var(--card2)', border: '1px solid var(--border-soft)',
      borderRadius: 16, padding: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={18} style={{ color: '#818CF8' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#E5E7EB', marginBottom: 6 }}>
            How Monthly Commitments works
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.7, marginBottom: 14 }}>
            This panel reads from your <strong style={{ color: '#C4B5FD' }}>category rules</strong>. When you create a rule that assigns a merchant to a recurring category — like <em>Subscriptions</em>, <em>Utilities</em>, or <em>Insurance</em> — it automatically appears here with its estimated monthly amount.
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.6, marginBottom: 18 }}>
            For example: a rule that maps &quot;Verizon&quot; → <em>Utilities</em>, or &quot;Netflix&quot; → <em>Subscriptions</em>, will show those merchants as monthly commitments once transactions match.
          </div>
          <button
            onClick={() => router.push('/rules')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8,
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
              color: '#818CF8', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Set up rules <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )

  // ── Deduplicate by normalized key ────────────────────────────────────────────
  const seen = new Map<string, Commitment>()
  for (const item of data.subscriptions) {
    const key = normalizeKeyUI(item.merchantNormalized)
    const existing = seen.get(key)
    if (!existing || item.subscriptionScore > existing.subscriptionScore) {
      seen.set(key, item)
    }
  }
  const items = [...seen.values()]

  // ── Rules exist but no matching transactions yet ──────────────────────────────
  if (items.length === 0) return (
    <div style={{ background: 'var(--card2)', border: '1px solid var(--border-soft)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Repeat2 size={18} style={{ color: '#818CF8' }} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#E5E7EB', marginBottom: 3 }}>No matching transactions yet</div>
        <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>Your rules are set up. Upload statements containing your recurring payments and they&apos;ll appear here automatically.</div>
      </div>
    </div>
  )

  // ── Classify + group ─────────────────────────────────────────────────────────
  const enriched = items.map(item => ({
    ...item,
    commitmentType: classifyCommitment(item.merchantNormalized, item.serviceCategory),
  }))

  const grouped = new Map<CommitmentType, typeof enriched>()
  for (const item of enriched) {
    if (!grouped.has(item.commitmentType)) grouped.set(item.commitmentType, [])
    grouped.get(item.commitmentType)!.push(item)
  }

  const totalMonthly = items.reduce((s, i) => s + i.estimatedMonthlyAmount, 0)

  return (
    <div style={{
      background: 'var(--card2, #0f1623)',
      border: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
      borderRadius: 16,
      padding: '20px 24px',
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: 'rgba(99,102,241,0.12)', borderRadius: 8, padding: '6px 7px', display: 'inline-flex' }}>
            <Repeat2 size={15} style={{ color: '#818CF8' }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #E5E7EB)' }}>
              Monthly Commitments
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #6B7280)', marginTop: 1 }}>
              {items.length} recurring payment{items.length !== 1 ? 's' : ''} detected
            </div>
          </div>
        </div>

        {/* Total */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary, #E5E7EB)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtAmt(totalMonthly)}
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted, #6B7280)', marginLeft: 3 }}>/mo</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted, #6B7280)', marginTop: 2 }}>
            {fmtWhole(totalMonthly * 12)}/yr
          </div>
        </div>
      </div>

      {/* Estimated total line */}
      <div style={{
        fontSize: 12, color: 'var(--text-secondary, #9CA3AF)',
        marginBottom: 18, paddingBottom: 16,
        borderBottom: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
      }}>
        Estimated recurring spending: <strong style={{ color: 'var(--text-primary, #E5E7EB)', fontVariantNumeric: 'tabular-nums' }}>{fmtAmt(totalMonthly)}/month</strong>
      </div>

      {/* ── Grouped rows ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {TYPE_ORDER.filter(type => grouped.has(type)).map(type => {
          const group = grouped.get(type)!
          const { label, color } = TYPE_CONFIG[type]

          return (
            <div key={type}>
              {/* Group label */}
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', color,
                marginBottom: 8, opacity: 0.75,
              }}>
                {label}
              </div>

              {/* Group rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group
                  .sort((a, b) => b.estimatedMonthlyAmount - a.estimatedMonthlyAmount)
                  .map(item => (
                    <CommitmentRow key={item.id} item={item} />
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
