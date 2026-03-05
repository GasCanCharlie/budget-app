'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { Sparkles, Send, ChevronDown, Loader2 } from 'lucide-react'

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

// ─── Wisdom renderer ─────────────────────────────────────────────────────────
// Splits AI message on "—" and renders the wisdom portion in italic

function MessageContent({ content }: { content: string }) {
  const dashIdx = content.lastIndexOf('\n—')
  if (dashIdx === -1) {
    return <span>{content}</span>
  }
  const main = content.slice(0, dashIdx)
  const wisdom = content.slice(dashIdx + 1) // includes "—\n*...*"
  return (
    <>
      <span>{main}</span>
      <span style={{ display: 'block', marginTop: 8, color: '#8b97c3', fontStyle: 'italic' }}>
        {wisdom}
      </span>
    </>
  )
}

// ─── Skeleton bubbles ─────────────────────────────────────────────────────────

function SkeletonBubbles() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
      {/* AI bubble skeleton */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'rgba(110,168,255,0.10)',
            flexShrink: 0,
            animation: 'skeletonPulse 1.5s ease-in-out infinite',
          }}
        />
        <div style={{ flex: 1, maxWidth: 420 }}>
          <div
            style={{
              height: 14,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              marginBottom: 6,
              animation: 'skeletonPulse 1.5s ease-in-out infinite',
            }}
          />
          <div
            style={{
              height: 14,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              width: '70%',
              animation: 'skeletonPulse 1.5s ease-in-out 0.2s infinite',
            }}
          />
        </div>
      </div>
      {/* User bubble skeleton */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            width: 160,
            height: 36,
            borderRadius: 16,
            background: 'rgba(110,168,255,0.08)',
            animation: 'skeletonPulse 1.5s ease-in-out 0.4s infinite',
          }}
        />
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '4px 2px' }}>
      {[0, 0.2, 0.4].map((delay, i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#8b97c3',
            display: 'inline-block',
            animation: `chatPulse 1.2s ease-in-out ${delay}s infinite`,
          }}
        />
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

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push('/login')
  }, [user, router])

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close month picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setShowMonthPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // ── Summary query ────────────────────────────────────────────────────────────

  const { data: summaryData, isLoading: summaryLoading } = useQuery<SummaryResponse>({
    queryKey: ['summary', year, month],
    queryFn: () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled: !!user,
  })

  const availableMonths = summaryData?.availableMonths ?? []
  const dashboardState = summaryData?.dashboardState
  const summary = summaryData?.summary

  // ── Welcome message (set once per month change) ───────────────────────────────

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  useEffect(() => {
    setMessages([
      {
        role: 'assistant',
        content: `Hello! I can answer questions about your budget for ${monthLabel}. Try asking: "Where did most of my money go?" or "How does this month compare to last month?"`,
      },
    ])
    setShowStarters(true)
    setShowPowerPrompts(false)
    setApiUnavailable(false)
    setApiError(null)
  }, [year, month, monthLabel])

  // ── Send message ──────────────────────────────────────────────────────────

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

    const aiPlaceholder: ChatMessage = { role: 'assistant', content: '', streaming: true }
    setMessages([...withUser, aiPlaceholder])
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
        } catch {
          // ignore parse failure
        }
        if (response.status === 503) setApiUnavailable(true)
        setApiError(errMsg)
        throw new Error(errMsg)
      }

      const data = await response.json() as {
        message?: string
        numbersUsed?: Array<{ label: string; value: string }>
        filters?: Record<string, string>
      }
      const responseText = data.message ?? ''

      setMessages(prev => {
        const next = [...prev]
        const last = next.length - 1
        if (next[last]?.role === 'assistant') {
          next[last] = {
            role: 'assistant',
            content: responseText,
            streaming: false,
            numbersUsed: data.numbersUsed,
            filters: data.filters,
          }
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
          if (next[last]?.role === 'assistant') {
            next[last] = { role: 'assistant', content: `Error: ${msg}`, streaming: false }
          }
          return next
        })
      }
    } finally {
      setIsStreaming(false)
    }
  }, [isStreaming, messages, token, year, month])

  const handleSend = useCallback(() => {
    sendMessage(inputText)
  }, [sendMessage, inputText])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const atLimit = messages.length >= MAX_MESSAGES

  // ── Styles ──────────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    maxWidth: 860,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 120px)',
    minHeight: 500,
  }

  const chatCardStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 24,
    overflow: 'hidden',
    minHeight: 0,
  }

  if (!user) return null

  return (
    <AppShell>
      <div style={containerStyle}>

        {/* ── Page header ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'rgba(110,168,255,0.12)',
                  border: '1px solid rgba(110,168,255,0.22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={15} style={{ color: '#6ea8ff' }} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#eaf0ff', margin: 0, letterSpacing: '-0.02em' }}>
                Ask AI
              </h1>
            </div>
            <p style={{ fontSize: 13, color: '#8b97c3', margin: 0 }}>
              Ask anything about your budget for {monthLabel}
            </p>
          </div>

          {/* Month picker */}
          <div ref={monthPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowMonthPicker(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: '#c8d4f5',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {MONTH_SHORT[month - 1]} {year}
              <ChevronDown size={13} style={{ color: '#8b97c3' }} />
            </button>

            {showMonthPicker && availableMonths.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: 'linear-gradient(180deg, #0d1225 0%, #080c1a 100%)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 12,
                  padding: '4px 0',
                  minWidth: 130,
                  zIndex: 50,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {availableMonths.map(m => {
                  const isSelected = m.year === year && m.month === month
                  return (
                    <button
                      key={`${m.year}-${m.month}`}
                      onClick={() => {
                        setYear(m.year)
                        setMonth(m.month)
                        setShowMonthPicker(false)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '7px 14px',
                        background: isSelected ? 'rgba(110,168,255,0.12)' : 'transparent',
                        border: 'none',
                        color: isSelected ? '#6ea8ff' : '#c8d4f5',
                        fontSize: 13,
                        cursor: 'pointer',
                        fontWeight: isSelected ? 600 : 400,
                      }}
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
        <div style={chatCardStyle}>

          {/* Messages area */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 20px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              minHeight: 0,
            }}
          >

            {/* Loading skeleton */}
            {summaryLoading && <SkeletonBubbles />}

            {/* Categorization gate */}
            {!summaryLoading && dashboardState === 'categorization_required' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: 12,
                  textAlign: 'center',
                  padding: '40px 20px',
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: 'rgba(255,165,0,0.10)',
                    border: '1px solid rgba(255,165,0,0.20)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Sparkles size={20} style={{ color: '#f59e0b' }} />
                </div>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#eaf0ff', margin: 0 }}>
                  Categorization required
                </p>
                <p style={{ fontSize: 13, color: '#8b97c3', margin: 0, maxWidth: 340 }}>
                  Finish categorizing your transactions to unlock AI chat for this month.
                </p>
              </div>
            )}

            {/* API unavailable banner */}
            {apiUnavailable && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(248,113,113,0.08)',
                  border: '1px solid rgba(248,113,113,0.18)',
                  fontSize: 13,
                  color: '#f87171',
                  textAlign: 'center',
                }}
              >
                {apiError ?? 'AI chat is not available right now.'}
              </div>
            )}

            {/* Messages */}
            {!summaryLoading && dashboardState !== 'categorization_required' && messages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'assistant' ? (
                  /* AI message */
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: 'rgba(110,168,255,0.12)',
                        border: '1px solid rgba(110,168,255,0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      <Sparkles size={13} style={{ color: '#6ea8ff' }} />
                    </div>
                    <div
                      style={{
                        maxWidth: 'calc(100% - 46px)',
                        padding: '10px 14px',
                        borderRadius: '4px 16px 16px 16px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: '#c8d4f5',
                      }}
                    >
                      {msg.streaming && msg.content.length === 0 ? (
                        <TypingDots />
                      ) : (
                        <MessageContent content={msg.content} />
                      )}
                    </div>
                  </div>
                ) : (
                  /* User message */
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        maxWidth: '75%',
                        padding: '10px 14px',
                        borderRadius: '16px 4px 16px 16px',
                        background: 'rgba(110,168,255,0.15)',
                        border: '1px solid rgba(110,168,255,0.25)',
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: '#eaf0ff',
                      }}
                    >
                      {msg.content}
                    </div>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.07)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#8b97c3',
                        letterSpacing: '0.02em',
                      }}
                    >
                      You
                    </div>
                  </div>
                )}

                {/* Number chips — shown after assistant messages (non-streaming, with numbersUsed) */}
                {msg.role === 'assistant' && !msg.streaming && (msg.numbersUsed?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, paddingLeft: 38 }}>
                    {msg.numbersUsed!.map((n, ni) => (
                      <span key={ni} style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: 'rgba(110,168,255,0.08)',
                        border: '1px solid rgba(110,168,255,0.15)',
                        color: '#8b97c3',
                      }}>
                        {n.label}: <strong style={{ color: '#c8d4f5' }}>{n.value}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* View transactions button — shown when filters are present */}
                {msg.role === 'assistant' && !msg.streaming && msg.filters && Object.keys(msg.filters).length > 0 && (
                  <button
                    onClick={() => {
                      const params = new URLSearchParams(msg.filters as Record<string, string>)
                      router.push(`/transactions?${params.toString()}`)
                    }}
                    style={{
                      marginTop: 6,
                      marginLeft: 38,
                      fontSize: 11,
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'rgba(110,168,255,0.10)',
                      border: '1px solid rgba(110,168,255,0.20)',
                      color: '#6ea8ff',
                      cursor: 'pointer',
                      display: 'inline-block',
                    }}
                  >
                    View transactions →
                  </button>
                )}

                {/* Starter prompts — show below first (welcome) AI message only */}
                {i === 0 && showStarters && msg.role === 'assistant' && (
                  <div style={{ marginTop: 12, paddingLeft: 38 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {STARTER_PROMPTS.map(prompt => (
                        <button
                          key={prompt}
                          onClick={() => sendMessage(prompt)}
                          disabled={isStreaming || summaryData?.dashboardState === 'categorization_required' || summaryLoading}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 20,
                            background: 'rgba(110,168,255,0.08)',
                            border: '1px solid rgba(110,168,255,0.18)',
                            color: '#6ea8ff',
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 500,
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => {
                            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(110,168,255,0.15)'
                          }}
                          onMouseLeave={e => {
                            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(110,168,255,0.08)'
                          }}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>

                    {/* "More prompts" expander */}
                    <div style={{ marginTop: 6 }}>
                      <button
                        onClick={() => setShowPowerPrompts(v => !v)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 20,
                          background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.10)',
                          color: '#8b97c3',
                          fontSize: 11,
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
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
                              style={{
                                padding: '6px 12px',
                                borderRadius: 20,
                                background: 'rgba(168,110,255,0.08)',
                                border: '1px solid rgba(168,110,255,0.18)',
                                color: '#a78bfa',
                                fontSize: 12,
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => {
                                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(168,110,255,0.15)'
                              }}
                              onMouseLeave={e => {
                                ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(168,110,255,0.08)'
                              }}
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

            {/* Context strip (shown when summary loaded) */}
            {!summaryLoading && summary && dashboardState === 'analysis_unlocked' && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.20)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: 11,
                  color: '#8b97c3',
                  lineHeight: 1.6,
                }}
              >
                <span style={{ color: '#eaf0ff', fontWeight: 600 }}>{monthLabel}:</span>
                {' '}Income {fmtCurrency(summary.totalIncome)} · Spending {fmtCurrency(summary.totalSpending)} · Net{' '}
                <span style={{ color: summary.net >= 0 ? '#2ee59d' : '#f87171' }}>
                  {fmtCurrency(summary.net)}
                </span>
                {' '}· Answers are based on your transaction data only — no raw descriptions are shared with AI.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input area ─────────────────────────────────────────── */}
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(0,0,0,0.18)',
              flexShrink: 0,
            }}
          >
            {atLimit ? (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <p style={{ fontSize: 13, color: '#8b97c3', marginBottom: 10 }}>
                  Start a new conversation to keep chatting.
                </p>
                <button
                  onClick={() => {
                    setMessages([
                      {
                        role: 'assistant',
                        content: `Hello! I can answer questions about your budget for ${monthLabel}. Try asking: "Where did most of my money go?" or "How does this month compare to last month?"`,
                      },
                    ])
                    setShowStarters(true)
                    setShowPowerPrompts(false)
                  }}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 10,
                    background: 'rgba(110,168,255,0.12)',
                    border: '1px solid rgba(110,168,255,0.25)',
                    color: '#6ea8ff',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
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
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 16,
                    padding: '10px 14px',
                    fontSize: 14,
                    color: '#eaf0ff',
                    resize: 'none',
                    outline: 'none',
                    lineHeight: 1.5,
                    fontFamily: 'inherit',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ['--placeholder-color' as any]: 'rgba(255,255,255,0.3)',
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={isStreaming || !inputText.trim() || dashboardState === 'categorization_required' || summaryLoading}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background:
                      inputText.trim() && !isStreaming && dashboardState !== 'categorization_required'
                        ? 'linear-gradient(135deg, #6ea8ff, #a78bfa)'
                        : 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(110,168,255,0.25)',
                    color:
                      inputText.trim() && !isStreaming && dashboardState !== 'categorization_required'
                        ? '#ffffff'
                        : '#8b97c3',
                    cursor:
                      inputText.trim() && !isStreaming && dashboardState !== 'categorization_required'
                        ? 'pointer'
                        : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                  aria-label="Send message"
                >
                  {isStreaming ? (
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom nav spacer */}
        <div className="h-20 md:hidden" />
      </div>

      {/* ── Animations ────────────────────────────────────────────────── */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes chatPulse {
          0%, 100% { opacity: 0.35; transform: scale(0.75); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        textarea::placeholder { color: rgba(255,255,255,0.3); }
      `}</style>
    </AppShell>
  )
}
