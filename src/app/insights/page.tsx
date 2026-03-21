'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useInsightsUnlock } from '@/hooks/useInsightsUnlock'
import { AiInsightsPanel } from '@/components/dashboard/AiInsightsPanel'
import { FinancialAutopsyPanel } from '@/components/dashboard/FinancialAutopsyPanel'
import { useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Send, Loader2 } from 'lucide-react'
import type { InsightCard } from '@/lib/insights/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  categoryId: string
  categoryName: string
  total: number
  pctOfSpending: number
  transactionCount: number
  isIncome: boolean
}

interface UnlockedSummary {
  totalIncome: number
  totalSpending: number
  net: number
  categoryTotals: CategoryTotal[]
}

interface SummaryResponse {
  dashboardState: 'categorization_required' | 'analysis_unlocked'
  availableMonths: { year: number; month: number }[]
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
  'Show my top 5 merchants',
]

// ─── Topic clusters for dynamic follow-up prompts ─────────────────────────────

const PROMPT_CLUSTERS: { keywords: string[]; prompts: string[] }[] = [
  {
    keywords: ['food', 'eat', 'eating', 'dining', 'restaurant', 'grocery', 'groceries', 'meal', 'lunch', 'dinner', 'breakfast', 'coffee', 'cafe'],
    prompts: [
      'Which restaurant did I visit most?',
      'How much did I spend on groceries?',
      'How does my food spending compare to last month?',
      'Am I over my food budget?',
      'How many coffee runs did I make?',
      'What did I spend on delivery apps?',
    ],
  },
  {
    keywords: ['subscription', 'recurring', 'trial', 'netflix', 'spotify', 'streaming', 'saas', 'monthly charge', 'auto-renew'],
    prompts: [
      'Which subscriptions did I add this month?',
      'How much am I paying for subscriptions total?',
      'Any trials about to convert to paid?',
      'Which subscription costs the most?',
      'Which subscriptions have I not used?',
      'How did my subscription spend change vs last month?',
    ],
  },
  {
    keywords: ['save', 'saving', 'savings', 'cut', 'reduce', 'budget', 'limit', 'overspend', 'over budget', '$300', '$200', '$500'],
    prompts: [
      "What's my savings rate this month?",
      'Which category could I reduce most easily?',
      "What's my fixed cost baseline?",
      'Where are my biggest non-essential expenses?',
      'What would happen if I cut dining by half?',
      'How much did I save vs last month?',
    ],
  },
  {
    keywords: ['merchant', 'vendor', 'store', 'shop', 'amazon', 'walmart', 'target', 'top', 'most frequent', 'biggest'],
    prompts: [
      'Which vendor do I spend the most with?',
      "What's my most frequent purchase location?",
      'Any unusual merchant charges?',
      'Show my top 3 merchants this month',
      'How often did I shop at my top merchant?',
      'Which merchant increased the most vs last month?',
    ],
  },
  {
    keywords: ['income', 'earn', 'salary', 'deposit', 'paycheck', 'payroll', 'how much did i make'],
    prompts: [
      'How much of my income did I spend?',
      "What's my income vs last month?",
      'What percentage goes to essentials?',
      "What's my effective savings rate?",
      'How does my income cover my fixed costs?',
      'Did my income change this month?',
    ],
  },
  {
    keywords: ['compare', 'last month', 'trend', 'change', 'changed', 'vs', 'track', 'better', 'worse', 'improve'],
    prompts: [
      'Which category increased the most?',
      'What improved vs last month?',
      'Am I trending better or worse overall?',
      'Which month was my best financially?',
      'What stayed the same vs last month?',
      'Show me my biggest month-over-month change',
    ],
  },
  {
    keywords: ['transport', 'gas', 'fuel', 'uber', 'lyft', 'car', 'transit', 'commute', 'rideshare'],
    prompts: [
      'How much did I spend on rideshare vs driving?',
      'Is my transport cost going up or down?',
      'How does my commute cost compare to last month?',
      'What percentage of spending is transport?',
      'How many Uber/Lyft rides did I take?',
    ],
  },
  {
    keywords: ['health', 'gym', 'fitness', 'medical', 'pharmacy', 'doctor', 'wellness', 'supplement'],
    prompts: [
      'How much did I spend on health this month?',
      'Is my gym membership still being used?',
      'What health costs are recurring vs one-off?',
      'How does my health spend compare to last month?',
    ],
  },
  {
    keywords: ['entertainment', 'fun', 'movies', 'concert', 'event', 'bar', 'night out', 'weekend'],
    prompts: [
      'How much did I spend on nights out?',
      'What was my biggest entertainment expense?',
      'How does my fun spending compare to last month?',
      'Am I overspending on entertainment?',
      'What events or concerts did I spend on?',
    ],
  },
]

function getRelatedPrompts(lastMessage: string, asked: Set<string>): string[] {
  const lower = lastMessage.toLowerCase()
  const scored = PROMPT_CLUSTERS.map(cluster => ({
    prompts: cluster.prompts,
    score:   cluster.keywords.filter(kw => lower.includes(kw)).length,
  })).filter(m => m.score > 0).sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    // No topic match — rotate through starters not yet asked
    return STARTER_PROMPTS.filter(p => !asked.has(p)).slice(0, 6)
  }

  // Merge top cluster(s), dedupe, filter asked
  const pool = scored.flatMap(m => m.prompts)
  const unique = [...new Set(pool)].filter(p => !asked.has(p))
  // Pad with starters if fewer than 4 results
  if (unique.length < 4) {
    const extras = STARTER_PROMPTS.filter(p => !asked.has(p) && !unique.includes(p))
    return [...unique, ...extras].slice(0, 6)
  }
  return unique.slice(0, 6)
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// ─── Sub-components ───────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  // Render **bold** inline
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const nodes: React.ReactNode[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  function flushList() {
    if (!listItems.length) return
    if (listType === 'ul') {
      nodes.push(
        <ul key={nodes.length} style={{ margin: '6px 0 6px 0', paddingLeft: 18, lineHeight: 1.6 }}>
          {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      )
    } else {
      nodes.push(
        <ol key={nodes.length} style={{ margin: '6px 0 6px 0', paddingLeft: 20, lineHeight: 1.6 }}>
          {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ol>
      )
    }
    listItems = []
    listType = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const h3 = line.match(/^###\s+(.+)/)
    const h2 = line.match(/^##\s+(.+)/)
    const bullet = line.match(/^[-*]\s+(.+)/)
    const numbered = line.match(/^\d+\.\s+(.+)/)

    if (h3) {
      flushList()
      nodes.push(<p key={nodes.length} style={{ fontWeight: 700, fontSize: '0.9em', marginTop: 10, marginBottom: 2, color: 'var(--text)' }}>{renderInline(h3[1])}</p>)
    } else if (h2) {
      flushList()
      nodes.push(<p key={nodes.length} style={{ fontWeight: 700, fontSize: '0.95em', marginTop: 12, marginBottom: 2, color: 'var(--text)' }}>{renderInline(h2[1])}</p>)
    } else if (bullet) {
      if (listType === 'ol') flushList()
      listType = 'ul'
      listItems.push(bullet[1])
    } else if (numbered) {
      if (listType === 'ul') flushList()
      listType = 'ol'
      listItems.push(numbered[1])
    } else if (line.trim() === '') {
      flushList()
      if (nodes.length > 0) nodes.push(<br key={nodes.length} />)
    } else {
      flushList()
      nodes.push(<p key={nodes.length} style={{ margin: '4px 0', lineHeight: 1.6 }}>{renderInline(line)}</p>)
    }
  }
  flushList()

  return <div style={{ fontSize: '0.875rem' }}>{nodes}</div>
}

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

export default function InsightsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const token = useAuthStore(s => s.token)
  const { apiFetch } = useApi()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const autoNavigated = useRef(false)

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [showStarters, setShowStarters] = useState(true)
  const [currentPrompts, setCurrentPrompts] = useState<string[]>(STARTER_PROMPTS)
  const askedPromptsRef = useRef<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const { unlocked, loading: unlockLoading } = useInsightsUnlock()
  const queryClient = useQueryClient()

  const { data: insightsData } = useQuery<{ cards: InsightCard[]; isStale: boolean }>({
    queryKey: ['insights', year, month],
    queryFn:  () => apiFetch(`/api/insights?year=${year}&month=${month}`),
    enabled:  !!user && !!year && !!month,
    staleTime: 5 * 60_000,
  })

  // Auto-generate autopsy when page loads and no cards exist
  const [isAutoGenerating, setIsAutoGenerating] = useState(false)
  const autoGeneratedRef = useRef<string>('')  // tracks "year-month" already triggered

  useEffect(() => {
    if (!insightsData || !user) return
    const key = `${year}-${month}`
    if (autoGeneratedRef.current === key) return
    const autopsyCards = insightsData.cards.filter(c => c.card_type.startsWith('autopsy_'))
    if (autopsyCards.length > 0) return
    autoGeneratedRef.current = key
    setIsAutoGenerating(true)
    const authToken = useAuthStore.getState().token
    fetch('/api/insights/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ year, month }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ['insights', year, month] }))
      .catch(console.error)
      .finally(() => setIsAutoGenerating(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsData, year, month])

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])
  useEffect(() => {
    if (!unlockLoading && !unlocked) router.replace('/categorize?from=insights')
  }, [unlocked, unlockLoading, router])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { return () => { abortControllerRef.current?.abort() } }, [])

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data } = useQuery<SummaryResponse>({
    queryKey: ['summary', year, month],
    queryFn: () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled: !!user,
    refetchOnMount: 'always',
  })

  const availableMonths = data?.availableMonths ?? []
  const dashboardState = data?.dashboardState
  const summary = data?.summary
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  // Auto-navigate to most recent month
  useEffect(() => {
    if (availableMonths.length === 0) return
    const latest = availableMonths[0]
    if (!latest || autoNavigated.current) return
    setYear(latest.year)
    setMonth(latest.month)
    autoNavigated.current = true
  }, [availableMonths])

  // Reset chat when month changes
  useEffect(() => {
    setMessages([])
    setShowStarters(true)
    setApiUnavailable(false)
    setApiError(null)
    setCurrentPrompts(STARTER_PROMPTS)
    askedPromptsRef.current = new Set()
  }, [year, month, monthLabel])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }, [])

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming || messages.length >= MAX_MESSAGES) return

    setInputText('')
    setShowStarters(true)
    setApiUnavailable(false)
    setApiError(null)
    // Track asked question and update related prompts
    askedPromptsRef.current.add(trimmed)
    setCurrentPrompts(getRelatedPrompts(trimmed, askedPromptsRef.current))

    const withUser = [...messages, { role: 'user' as const, content: trimmed }]
    setMessages([...withUser, { role: 'assistant', content: '', streaming: true }])
    setIsStreaming(true)

    abortControllerRef.current = new AbortController()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const response = await fetch('/api/insights/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: trimmed,
          year,
          month,
          history: withUser.slice(-7, -1).map(m => ({ role: m.role, content: m.content })),
        }),
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

      const resData = await response.json() as {
        message?: string
        numbersUsed?: Array<{ label: string; value: string }>
        filters?: Record<string, string>
      }

      setMessages(prev => {
        const next = [...prev]
        const last = next.length - 1
        if (next[last]?.role === 'assistant') {
          next[last] = { role: 'assistant', content: resData.message ?? '', streaming: false, numbersUsed: resData.numbersUsed, filters: resData.filters }
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

  if (!user) return null

  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-6 pb-24">

        {/* ── Financial Autopsy — top of page, most prominent ─────────── */}
        <FinancialAutopsyPanel
          cards={insightsData?.cards ?? []}
          year={year}
          month={month}
          isAutoGenerating={isAutoGenerating}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['insights', year, month] })}
        />

        {/* ── Q&A section ─────────────────────────────────────────────── */}
        <div>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-muted)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageCircle size={13} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Q&amp;A</h2>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>· ask anything about {monthLabel}</span>
          </div>

          {/* Chat card */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-soft)' }}>

            {/* ── Input area — top ────────────────────────────────────── */}
            <div style={{ padding: '12px 16px', borderBottom: messages.length > 0 ? '1px solid var(--border)' : 'none', background: 'var(--bg2)', flexShrink: 0 }}>
              {atLimit ? (
                <div style={{ textAlign: 'center', padding: '4px 0' }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Start a new conversation to keep chatting.</p>
                  <button
                    onClick={() => { setMessages([]); setShowStarters(true); setCurrentPrompts(STARTER_PROMPTS); askedPromptsRef.current = new Set() }}
                    className="btn-secondary"
                  >
                    New conversation
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                  <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={dashboardState === 'categorization_required' ? 'Categorize transactions to unlock Q&A…' : `Ask me anything about your budget for ${monthLabel}…`}
                    rows={2}
                    disabled={isStreaming || dashboardState === 'categorization_required'}
                    style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-md)', padding: '10px 14px', fontSize: 14, color: 'var(--text)', resize: 'none', outline: 'none', lineHeight: 1.5, fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!canSend}
                    style={{ width: 42, height: 42, borderRadius: 12, background: canSend ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border2)', color: canSend ? '#ffffff' : 'var(--muted)', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
                    aria-label="Send"
                  >
                    {isStreaming ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                  </button>
                </div>
              )}

              {/* Prompts — always visible, update to related topics after each question */}
              {showStarters && dashboardState !== 'categorization_required' && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {currentPrompts.map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      disabled={isStreaming}
                      style={{ padding: '5px 11px', borderRadius: 20, background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 500, transition: 'opacity 0.15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Messages ────────────────────────────────────────────── */}
            {(messages.length > 0 || dashboardState === 'categorization_required' || apiUnavailable) && (
              <div style={{ maxHeight: 520, overflowY: 'auto', padding: '18px 18px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Categorization gate */}
                {dashboardState === 'categorization_required' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: '32px 20px' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--warn-muted)', border: '1px solid var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MessageCircle size={18} style={{ color: 'var(--warn)' }} />
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Categorization required</p>
                    <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, maxWidth: 320 }}>
                      Finish categorizing your transactions to unlock Q&amp;A for this month.
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
                {dashboardState !== 'categorization_required' && messages.map((msg, i) => (
                  <div key={i}>
                    {msg.role === 'assistant' ? (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent-muted)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          <MessageCircle size={12} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div style={{ maxWidth: 'calc(100% - 44px)', padding: '10px 14px', borderRadius: '4px 14px 14px 14px', background: 'var(--surface2)', border: '1px solid var(--border2)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                          {msg.streaming && msg.content.length === 0 ? <TypingDots /> : <MessageContent content={msg.content} />}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: '14px 4px 14px 14px', background: 'var(--accent-muted)', border: '1px solid var(--border2)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)' }}>
                          {msg.content}
                        </div>
                        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.02em' }}>
                          You
                        </div>
                      </div>
                    )}

                    {/* Number chips */}
                    {msg.role === 'assistant' && !msg.streaming && (msg.numbersUsed?.length ?? 0) > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, paddingLeft: 36 }}>
                        {msg.numbersUsed!.map((n, ni) => (
                          <span key={ni} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--muted)' }}>
                            {n.label}: <strong style={{ color: 'var(--text)' }}>{n.value}</strong>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* View transactions link */}
                    {msg.role === 'assistant' && !msg.streaming && msg.filters && Object.keys(msg.filters).length > 0 && (
                      <button
                        onClick={() => { const p = new URLSearchParams(msg.filters as Record<string, string>); router.push(`/transactions?${p.toString()}`) }}
                        style={{ marginTop: 6, marginLeft: 36, fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-muted)', border: '1px solid var(--border2)', color: 'var(--accent)', cursor: 'pointer', display: 'inline-block' }}
                      >
                        View transactions →
                      </button>
                    )}
                  </div>
                ))}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* ── AI Insights panel ───────────────────────────────────────── */}
        <AiInsightsPanel year={year} month={month} />

      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes chatPulse { 0%, 100% { opacity: 0.35; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1); } }
      `}</style>
    </AppShell>
  )
}
