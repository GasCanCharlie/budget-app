'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { MessageCircle, Send, ChevronDown, Loader2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  categoryId: string
  categoryName: string
  total: number
  pctOfSpending: number
  transactionCount: number
  isIncome: boolean
}

interface TopTx {
  id: string
  merchantNormalized: string
  amount: number
  transactionCount?: number
}

interface UnlockedSummary {
  totalIncome: number
  totalSpending: number
  net: number
  categoryTotals: CategoryTotal[]
  topTransactions: TopTx[]
}

interface SummaryResponse {
  dashboardState: 'categorization_required' | 'analysis_unlocked'
  availableMonths: { year: number; month: number }[]
  rolling: { spending: number; income: number } | null
  summary: UnlockedSummary | null
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  numbersUsed?: Array<{ label: string; value: string }>
  filters?: Record<string, string>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const MAX_MESSAGES = 20

const STARTER_PROMPTS = [
  'Where did most of my money go?',
  'Am I on track this month?',
  'What are my biggest recurring charges?',
  'How many times did I eat out?',
  'Any new subscriptions or trials charging?',
  'What changed vs last month?',
  "What's my fixed cost baseline?",
  'Where can I cut $300 without hurting?',
  'What day do I spend the most?',
  'Show my top 5 merchants',
]

const POWER_PROMPTS = [
  'How many Costco trips this month?',
  'Roughly how often am I buying coffee?',
  'What would my savings rate be if I cut Housing?',
]

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

// ─── Message content renderer ─────────────────────────────────────────────────

function MessageContent({ content }: { content: string }) {
  const dashIdx = content.lastIndexOf('\n—')
  if (dashIdx === -1) return <span>{content}</span>
  const main = content.slice(0, dashIdx)
  const wisdom = content.slice(dashIdx + 1)
  return (
    <>
      <span>{main}</span>
      <span style={{ display: 'block', marginTop: 8, color: 'var(--muted)', fontStyle: 'italic' }}>
        {wisdom}
      </span>
    </>
  )
}

// ─── Skeleton bubbles ─────────────────────────────────────────────────────────

function SkeletonBubbles() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-muted)', flexShrink: 0, animation: 'skeletonPulse 1.5s ease-in-out infinite' }} />
        <div style={{ flex: 1, maxWidth: 420 }}>
          <div style={{ height: 14, borderRadius: 8, background: 'var(--surface2)', marginBottom: 6, animation: 'skeletonPulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 14, borderRadius: 8, background: 'var(--surface2)', width: '70%', animation: 'skeletonPulse 1.5s ease-in-out 0.2s infinite' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 160, height: 36, borderRadius: 16, background: 'var(--accent-muted)', animation: 'skeletonPulse 1.5s ease-in-out 0.4s infinite' }} />
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '4px 2px' }}>
      {[0, 0.2, 0.4].map((delay, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)', display: 'inline-block', animation: `chatPulse 1.2s ease-in-out ${delay}s infinite` }} />
      ))}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const token = useAuthStore(s => s.token)
  const { apiFetch } = useApi()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [showMonthPicker, setShowMonthPicker] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [showStarters, setShowStarters] = useState(true)
  const [showPowerPrompts, setShowPowerPrompts] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const monthPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!user) router.push('/login') }, [user, router])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setShowMonthPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])
  useEffect(() => { return () => { abortControllerRef.current?.abort() } }, [])

  const { data: summaryData, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ['summary', year, month],
    queryFn: () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled: !!user,
  })

  const availableMonths = summaryData?.availableMonths ?? []
  const dashboardState = summaryData?.dashboardState
  const summary = summaryData?.summary
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Hello! I can answer questions about your budget for ${monthLabel}. Try asking: "Where did most of my money go?" or "How does this month compare to last month?"`,
    }])
    setShowStarters(true)
    setShowPowerPrompts(false)
    setApiUnavailable(false)
    setApiError(null)
  }, [year, month, monthLabel])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    if (messages.length >= MAX_MESSAGES) return

    setInputText('')
    setShowStarters(false)
    setApiUnavailable(false)
    setApiError(null)

    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setMessages([...withUser, { role: 'assistant', content: '', streaming: true }])
    setIsStreaming(true)

    abortControllerRef.current = new AbortController()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const response = await fetch('/api/insights/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: trimmed, year, month }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`
        try {
          const errBody = await response.json() as { error?: string }
          if (errBody.error) errMsg = errBody.error
        } catch { /* ignore */ }
        if (response.status === 503) setApiUnavailable(true)
        setApiError(errMsg)
        throw new Error(errMsg)
      }

      const data = await response.json() as {
        message?: string
        numbersUsed?: Array<{ label: string; value: string }>
        filters?: Record<string, string>
      }

      setMessages(prev => {
        const next = [...prev]
        const last = next.length - 1
        if (next[last]?.role === 'assistant') {
          next[last] = { role: 'assistant', content: data.message ?? '', streaming: false, numbersUsed: data.numbersUsed, filters: data.filters }
        }
        return next
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.slice(0, -1))
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setMessages(prev => {
          const next = [...prev]
          const last = next.length - 1
          if (next[last]?.role === 'assistant') next[last] = { role: 'assistant', content: `Error: ${msg}`, streaming: false }
          return next
        })
      }
    } finally {
      setIsStreaming(false)
    }
  }, [isStreaming, messages, token, year, month])

  const handleSend = useCallback(() => sendMessage(inputText), [sendMessage, inputText])
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const atLimit = messages.length >= MAX_MESSAGES
  const canSend = !!inputText.trim() && !isStreaming && dashboardState !== 'categorization_required'

  const welcomeMsg = `Hello! I can answer questions about your budget for ${monthLabel}. Try asking: "Where did most of my money go?" or "How does this month compare to last month?"`

  if (!user) return null

  return (
    <AppShell>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 500 }}>

        {/* ── Header ────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--accent-muted)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageCircle size={15} style={{ color: 'var(--accent)' }} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '-0.025em' }}>Chat</h1>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: 0 }}>
              Ask anything about your budget for {monthLabel}
            </p>
          </div>

          {/* Month picker */}
          <div ref={monthPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowMonthPicker(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              {MONTH_SHORT[month - 1]} {year}
              <ChevronDown size={13} style={{ color: 'var(--muted)' }} />
            </button>

            {showMonthPicker && availableMonths.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '4px 0', minWidth: 130, zIndex: 50, boxShadow: 'var(--shadow)', maxHeight: 240, overflowY: 'auto' }}>
                {availableMonths.map(m => {
                  const isSelected = m.year === year && m.month === month
                  return (
                    <button
                      key={`${m.year}-${m.month}`}
                      onClick={() => { setYear(m.year); setMonth(m.month); setShowMonthPicker(false) }}
                      style={{ width: '100%', textAlign: 'left', padding: '7px 14px', background: isSelected ? 'var(--accent-muted)' : 'transparent', border: 'none', color: isSelected ? 'var(--accent)' : 'var(--text)', fontSize: 13, cursor: 'pointer', fontWeight: isSelected ? 600 : 400 }}
                    >
                      {MONTH_SHORT[m.month - 1]} {m.year}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Chat card ───────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 0, boxShadow: 'var(--shadow-soft)' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>

            {summaryLoading && <SkeletonBubbles />}

            {/* Categorization gate */}
            {!summaryLoading && dashboardState === 'categorization_required' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--warn-muted)', border: '1px solid var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageCircle size={20} style={{ color: 'var(--warn)' }} />
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Categorization required</p>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, maxWidth: 340 }}>
                  Finish categorizing your transactions to unlock chat for this month.
                </p>
              </div>
            )}

            {/* Error banner */}
            {apiUnavailable && (
              <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', fontSize: 13, color: 'var(--danger)', textAlign: 'center' }}>
                {apiError ?? 'Chat is not available right now.'}
              </div>
            )}

            {/* Messages */}
            {!summaryLoading && dashboardState !== 'categorization_required' && messages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'assistant' ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-muted)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <MessageCircle size={13} style={{ color: 'var(--accent)' }} />
                    </div>
                    <div style={{ maxWidth: 'calc(100% - 46px)', padding: '10px 14px', borderRadius: '4px 16px 16px 16px', background: 'var(--surface2)', border: '1px solid var(--border2)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                      {msg.streaming && msg.content.length === 0 ? <TypingDots /> : <MessageContent content={msg.content} />}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ maxWidth: '75%', padding: '10px 14px', borderRadius: '16px 4px 16px 16px', background: 'var(--accent-muted)', border: '1px solid var(--border2)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                      {msg.content}
                    </div>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.02em' }}>
                      You
                    </div>
                  </div>
                )}

                {/* Number chips */}
                {msg.role === 'assistant' && !msg.streaming && (msg.numbersUsed?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, paddingLeft: 38 }}>
                    {msg.numbersUsed!.map((n, ni) => (
                      <span key={ni} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--muted)' }}>
                        {n.label}: <strong style={{ color: 'var(--text)' }}>{n.value}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* View transactions button */}
                {msg.role === 'assistant' && !msg.streaming && msg.filters && Object.keys(msg.filters).length > 0 && (
                  <button
                    onClick={() => { const params = new URLSearchParams(msg.filters as Record<string, string>); router.push(`/transactions?${params.toString()}`) }}
                    style={{ marginTop: 6, marginLeft: 38, fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--accent)', cursor: 'pointer', display: 'inline-block' }}
                  >
                    View transactions →
                  </button>
                )}

                {/* Starter prompts */}
                {i === 0 && showStarters && msg.role === 'assistant' && (
                  <div style={{ marginTop: 12, paddingLeft: 38 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {STARTER_PROMPTS.map(prompt => (
                        <button
                          key={prompt}
                          onClick={() => sendMessage(prompt)}
                          disabled={isStreaming || summaryData?.dashboardState === 'categorization_required' || summaryLoading}
                          style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 500, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>

                    <div style={{ marginTop: 6 }}>
                      <button
                        onClick={() => setShowPowerPrompts(v => !v)}
                        style={{ padding: '4px 10px', borderRadius: 20, background: 'transparent', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}
                      >
                        {showPowerPrompts ? 'Fewer prompts ▴' : 'More prompts ▾'}
                      </button>

                      {showPowerPrompts && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {POWER_PROMPTS.map(prompt => (
                            <button
                              key={prompt}
                              onClick={() => sendMessage(prompt)}
                              disabled={isStreaming || summaryData?.dashboardState === 'categorization_required' || summaryLoading}
                              style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--accent2)', fontSize: 12, cursor: 'pointer', fontWeight: 500, transition: 'opacity 0.15s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.75' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Context strip */}
            {!summaryLoading && summary && dashboardState === 'analysis_unlocked' && (
              <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface2)', border: '1px solid var(--border2)', fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{monthLabel}:</span>
                {' '}Income {fmtCurrency(summary.totalIncome)} · Spending {fmtCurrency(summary.totalSpending)} · Net{' '}
                <span style={{ color: summary.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {fmtCurrency(summary.net)}
                </span>
                {' '}· Answers are based on your transaction data only.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input area ──────────────────────────────────────────── */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border2)', background: 'var(--bg2)', flexShrink: 0 }}>
            {atLimit ? (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                  Start a new conversation to keep chatting.
                </p>
                <button
                  onClick={() => { setMessages([{ role: 'assistant', content: welcomeMsg }]); setShowStarters(true); setShowPowerPrompts(false) }}
                  className="btn-secondary"
                >
                  Start a new conversation
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your budget…"
                  rows={2}
                  disabled={isStreaming || dashboardState === 'categorization_required' || summaryLoading}
                  style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 14, color: 'var(--text)', resize: 'none', outline: 'none', lineHeight: 1.5, fontFamily: 'inherit' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!canSend || summaryLoading}
                  style={{ width: 42, height: 42, borderRadius: 12, background: canSend ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border2)', color: canSend ? '#ffffff' : 'var(--muted)', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                  aria-label="Send message"
                >
                  {isStreaming ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="h-20 md:hidden" />
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes chatPulse { 0%, 100% { opacity: 0.35; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes skeletonPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
      `}</style>
    </AppShell>
  )
}
