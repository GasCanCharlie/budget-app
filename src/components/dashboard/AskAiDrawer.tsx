'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, X, Send, MessageCircle, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  name: string
  total: number
  pctOfSpending: number
}

interface TopMerchant {
  merchantNormalized: string
  totalAmount: number
  transactionCount: number
}

interface AskAiDrawerContext {
  year: number
  month: number
  totalIncome: number
  totalSpending: number
  net: number
  categoryTotals: CategoryTotal[]
  topMerchants: TopMerchant[]
  momSpendingPctChange: number | null
}

interface AskAiDrawerProps {
  isOpen: boolean
  onClose: () => void
  context: AskAiDrawerContext
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const MAX_TURNS = 10

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// ─── Component ────────────────────────────────────────────────────────────────

export function AskAiDrawer({ isOpen, onClose, context }: AskAiDrawerProps) {
  const token = useAuthStore(s => s.token)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [apiUnavailable, setApiUnavailable] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300)
    }
  }, [isOpen])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const handleClose = useCallback(() => {
    abortControllerRef.current?.abort()
    onClose()
  }, [onClose])

  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isStreaming) return
    if (messages.length >= MAX_TURNS * 2) return

    setInputText('')
    setApiUnavailable(false)

    const userMsg: ChatMessage = { role: 'user', content: text }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)

    // Add placeholder for AI response
    const aiPlaceholder: ChatMessage = { role: 'assistant', content: '', streaming: true }
    setMessages([...updatedMessages, aiPlaceholder])
    setIsStreaming(true)

    abortControllerRef.current = new AbortController()

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const response = await fetch('/api/insights/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          context,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Stream the response
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        accumulated += chunk

        // Update the streaming message
        setMessages(prev => {
          const next = [...prev]
          const lastIdx = next.length - 1
          if (next[lastIdx]?.role === 'assistant') {
            next[lastIdx] = { role: 'assistant', content: accumulated, streaming: true }
          }
          return next
        })
      }

      // Finalize the message (remove streaming flag)
      setMessages(prev => {
        const next = [...prev]
        const lastIdx = next.length - 1
        if (next[lastIdx]?.role === 'assistant') {
          next[lastIdx] = { role: 'assistant', content: accumulated, streaming: false }
        }
        return next
      })

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User aborted — remove the placeholder
        setMessages(prev => prev.filter((_, i) => i < prev.length - 1))
      } else {
        setApiUnavailable(true)
        // Replace placeholder with error message
        setMessages(prev => {
          const next = [...prev]
          const lastIdx = next.length - 1
          if (next[lastIdx]?.role === 'assistant') {
            next[lastIdx] = {
              role: 'assistant',
              content: 'AI chat is temporarily unavailable.',
              streaming: false,
            }
          }
          return next
        })
      }
    } finally {
      setIsStreaming(false)
    }
  }, [inputText, isStreaming, messages, token, context.year, context.month])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const atLimit = messages.length >= MAX_TURNS * 2
  const monthLabel = `${MONTH_NAMES[context.month - 1]} ${context.year}`

  // ── Styles ─────────────────────────────────────────────────────────────────

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.60)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    zIndex: 100,
    opacity: isOpen ? 1 : 0,
    pointerEvents: isOpen ? 'auto' : 'none',
    transition: 'opacity 0.25s ease',
  }

  const drawerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 380,
    maxWidth: '100vw',
    background: 'linear-gradient(180deg, #0d1225 0%, #080c1a 100%)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRight: 'none',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 101,
    transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
    boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
  }

  return (
    <>
      {/* Overlay */}
      <div style={overlayStyle} onClick={handleClose} aria-hidden="true" />

      {/* Drawer */}
      <div style={drawerStyle} role="dialog" aria-label="Ask AI">
        {/* ── Header ── */}
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'rgba(110,168,255,0.12)',
                  border: '1px solid rgba(110,168,255,0.20)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={13} style={{ color: '#6ea8ff' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#eaf0ff' }}>Ask AI</div>
                <div style={{ fontSize: 10, color: '#8b97c3' }}>{monthLabel}</div>
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b97c3',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6,
                display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Disclaimer */}
          <p
            style={{
              fontSize: 10,
              color: '#6b7499',
              background: 'rgba(110,168,255,0.06)',
              border: '1px solid rgba(110,168,255,0.10)',
              borderRadius: 8,
              padding: '5px 10px',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Answers are based on your transaction data only — no raw descriptions are shared with AI.
          </p>
        </div>

        {/* ── Context strip ── */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(0,0,0,0.20)',
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: 10, color: '#8b97c3', margin: 0, lineHeight: 1.6 }}>
            <span style={{ color: '#eaf0ff', fontWeight: 600 }}>{monthLabel}:</span>
            {' '}Income {fmtCurrency(context.totalIncome)} · Spending {fmtCurrency(context.totalSpending)} · Net{' '}
            <span style={{ color: context.net >= 0 ? '#2ee59d' : '#f87171' }}>
              {fmtCurrency(context.net)}
            </span>
            {context.momSpendingPctChange !== null && (
              <> · MoM {context.momSpendingPctChange > 0 ? '+' : ''}{Math.round(context.momSpendingPctChange)}%</>
            )}
          </p>
        </div>

        {/* ── Messages ── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 40, color: '#6b7499' }}>
              <Sparkles size={24} style={{ margin: '0 auto 8px', color: '#8b97c3' }} />
              <p style={{ fontSize: 13, marginBottom: 4 }}>Ask a question about your finances</p>
              <p style={{ fontSize: 11 }}>e.g. &quot;What&apos;s my biggest expense this month?&quot;</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  ...(msg.role === 'user'
                    ? {
                        background: 'linear-gradient(135deg, #3b5bdb, #1e40af)',
                        color: '#ffffff',
                      }
                    : {
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#c8d4f5',
                      }),
                }}
              >
                {msg.content}
                {msg.streaming && msg.content.length === 0 && (
                  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '2px 0' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b97c3', animation: 'pulse 1.2s ease-in-out infinite' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b97c3', animation: 'pulse 1.2s ease-in-out 0.2s infinite' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b97c3', animation: 'pulse 1.2s ease-in-out 0.4s infinite' }} />
                  </span>
                )}
              </div>
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '12px 12px 12px 4px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Loader2 size={14} style={{ color: '#8b97c3', animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          )}

          {apiUnavailable && (
            <p style={{ fontSize: 11, color: '#f87171', textAlign: 'center' }}>
              AI chat is temporarily unavailable.
            </p>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ── */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
            background: 'rgba(0,0,0,0.20)',
          }}
        >
          {atLimit ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <p style={{ fontSize: 12, color: '#8b97c3', marginBottom: 8 }}>
                Maximum conversation length reached.
              </p>
              <button
                onClick={() => setMessages([])}
                style={{
                  background: 'rgba(110,168,255,0.12)',
                  border: '1px solid rgba(110,168,255,0.25)',
                  color: '#6ea8ff',
                  fontSize: 11,
                  borderRadius: 8,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
              >
                Start a new conversation
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your finances…"
                rows={2}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontSize: 13,
                  color: '#eaf0ff',
                  resize: 'none',
                  outline: 'none',
                  lineHeight: 1.4,
                  fontFamily: 'inherit',
                }}
                disabled={isStreaming}
              />
              <button
                onClick={sendMessage}
                disabled={isStreaming || !inputText.trim()}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: inputText.trim() && !isStreaming
                    ? 'linear-gradient(135deg, #3b5bdb, #1e40af)'
                    : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(110,168,255,0.25)',
                  color: inputText.trim() && !isStreaming ? '#ffffff' : '#8b97c3',
                  cursor: inputText.trim() && !isStreaming ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                {isStreaming
                  ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Send size={14} />
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        @media (max-width: 640px) {
          [role="dialog"] {
            width: 100% !important;
            top: auto !important;
            height: 80vh;
            border-radius: 20px 20px 0 0 !important;
          }
        }
      `}</style>
    </>
  )
}

// ─── Floating Ask AI FAB ───────────────────────────────────────────────────────

interface AskAiFabProps {
  onClick: () => void
}

export function AskAiFab({ onClick }: AskAiFabProps) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: 80,
        right: 20,
        zIndex: 50,
        background: 'linear-gradient(135deg, #3b5bdb, #1e40af)',
        border: '1px solid rgba(110,168,255,0.30)',
        borderRadius: 28,
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 20px rgba(59,91,219,0.40)',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, transform 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 28px rgba(59,91,219,0.55)'
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(59,91,219,0.40)'
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
      }}
      aria-label="Ask AI about your finances"
    >
      <MessageCircle size={18} style={{ color: 'white' }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Ask AI</span>
    </button>
  )
}
