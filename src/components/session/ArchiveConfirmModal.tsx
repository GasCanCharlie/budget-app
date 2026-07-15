'use client'

import { useState } from 'react'
import { Archive, X, Calendar, LayoutList, Loader2 } from 'lucide-react'

export interface ArchiveConfirmModalProps {
  isOpen:         boolean
  onClose:        () => void
  sessionTitle:   string
  dateRangeStart: string | null
  dateRangeEnd:   string | null
  txCount:        number
  accountCount:   number
  accounts:       Array<{ name: string; accountType: string }>
  onConfirm:      (startNew: boolean) => void
  isPending:      boolean
}

function fmtRange(start: string | null, end: string | null): string {
  if (!start) return 'No date range'
  const fmtMonthYear = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  const fmtMonth = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short' })
  if (!end || start === end) return fmtMonthYear(start)
  const s = new Date(start), e = new Date(end)
  if (s.getFullYear() === e.getFullYear())
    return `${fmtMonth(start)} – ${fmtMonthYear(end)}`
  return `${fmtMonthYear(start)} – ${fmtMonthYear(end)}`
}

export function ArchiveConfirmModal({
  isOpen, onClose, sessionTitle, dateRangeStart, dateRangeEnd,
  txCount, accountCount, accounts, onConfirm, isPending,
}: ArchiveConfirmModalProps) {
  const [startNew, setStartNew] = useState(false)

  if (!isOpen) return null

  const monthsLoaded = dateRangeStart && dateRangeEnd
    ? Math.max(1, Math.round(
        (new Date(dateRangeEnd).getTime() - new Date(dateRangeStart).getTime())
        / (30 * 24 * 60 * 60 * 1000),
      ))
    : 0

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div style={{ position: 'fixed', inset: 0, zIndex: 51, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-modal-title"
          style={{ background: '#0F1117', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Archive size={18} style={{ color: '#22c55e' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p id="archive-modal-title" style={{ fontSize: '1rem', fontWeight: 700, color: '#E5E7EB', lineHeight: 1.2 }}>
                Finish & Archive
              </p>
              <p style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 2 }}>Lock in your results</p>
            </div>
            <button
              onClick={onClose}
              disabled={isPending}
              style={{ padding: 4, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 0 }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Session summary */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 16px', marginBottom: 18 }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#E5E7EB', marginBottom: 8 }}>
              {sessionTitle}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dateRangeStart && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#9CA3AF' }}>
                  <Calendar size={12} style={{ color: '#6B7280', flexShrink: 0 }} />
                  <span>{fmtRange(dateRangeStart, dateRangeEnd)}</span>
                  {monthsLoaded > 0 && (
                    <span style={{ color: '#6B7280' }}>
                      · {monthsLoaded} {monthsLoaded === 1 ? 'month' : 'months'}
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#9CA3AF' }}>
                <LayoutList size={12} style={{ color: '#6B7280', flexShrink: 0 }} />
                <span>
                  {txCount.toLocaleString()} transaction{txCount !== 1 ? 's' : ''}
                  {' · '}
                  {accountCount} {accountCount === 1 ? 'account' : 'accounts'}
                </span>
              </div>
              {accounts.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {accounts.slice(0, 3).map((a, i) => (
                    <span
                      key={i}
                      style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', color: '#D1D5DB', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      {a.name}
                    </span>
                  ))}
                  {accounts.length > 3 && (
                    <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                      +{accounts.length - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Start new toggle */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(108,124,255,0.05)', border: '1px solid rgba(108,124,255,0.12)', cursor: 'pointer', marginBottom: 18 }}>
            <input
              type="checkbox"
              checked={startNew}
              onChange={e => setStartNew(e.target.checked)}
              style={{ accentColor: '#6C7CFF', width: 15, height: 15, marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#E5E7EB' }}>
                Start a new analysis after archiving
              </p>
              <p style={{ fontSize: '0.73rem', color: '#6B7280', marginTop: 2 }}>
                Takes you to Upload so you can start fresh immediately.
              </p>
            </div>
          </label>

          <p style={{ fontSize: '0.72rem', color: '#6B7280', marginBottom: 22 }}>
            Archived analyses are saved in History and can be reopened at any time.
          </p>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              disabled={isPending}
              style={{ padding: '8px 16px', borderRadius: 10, fontSize: '0.82rem', fontWeight: 600, color: '#9CA3AF', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(startNew)}
              disabled={isPending}
              className="flex items-center"
              style={{ gap: 8, padding: '8px 18px', borderRadius: 10, fontSize: '0.82rem', fontWeight: 600, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.2)', cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}
            >
              {isPending
                ? <Loader2 size={14} className="animate-spin" />
                : <Archive size={14} />}
              {startNew ? 'Archive & Start New' : 'Archive Analysis'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
