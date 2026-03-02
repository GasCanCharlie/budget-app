'use client'

import Link from 'next/link'
import { ArrowRight, Calendar, Database, Building2 } from 'lucide-react'

interface Props {
  uncategorizedCount: number
  totalCount:         number
  categorizedCount:   number
  dateRangeStart:     string | null
  dateRangeEnd:       string | null
  accountNames:       string[]
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CategorizationGate({
  uncategorizedCount,
  totalCount,
  categorizedCount,
  dateRangeStart,
  dateRangeEnd,
  accountNames,
}: Props) {
  const pct = totalCount > 0 ? Math.round((categorizedCount / totalCount) * 100) : 0

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-16">

      {/* ── Gate module ────────────────────────────────────────────────────── */}
      <div className="w-full max-w-md">

        {/* Status indicator */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-200 bg-amber-50">
            <span className="text-2xl">⚡</span>
          </div>
        </div>

        {/* Headline */}
        <h2 className="mb-2 text-center text-xl font-bold text-slate-900">
          Statement Not Fully Structured
        </h2>
        <p className="mb-8 text-center text-sm text-slate-500">
          Financial analysis only runs on fully-categorized datasets.
          Assign a category to every transaction to unlock the dashboard.
        </p>

        {/* Progress bar */}
        <div className="mb-2 flex items-center justify-between text-xs font-semibold">
          <span className="text-slate-600">{pct}% categorized</span>
          <span className="text-amber-600">{uncategorizedCount} remaining</span>
        </div>
        <div className="mb-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mb-8 text-center text-xs text-slate-400">
          {categorizedCount} of {totalCount} transactions categorized
        </p>

        {/* CTA button */}
        <Link
          href="/categorize"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-amber-600 transition-colors"
        >
          Continue Categorizing
          <ArrowRight size={16} />
        </Link>

      </div>

      {/* ── Minimal metadata ────────────────────────────────────────────────── */}
      {(dateRangeStart || accountNames.length > 0) && (
        <div className="mt-12 w-full max-w-md rounded-xl border border-slate-100 bg-slate-50 px-5 py-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Statement info
          </p>
          <div className="space-y-2.5">
            {dateRangeStart && dateRangeEnd && (
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <Calendar size={14} className="flex-shrink-0 text-slate-400" />
                <span>{fmtDate(dateRangeStart)} – {fmtDate(dateRangeEnd)}</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 text-sm text-slate-600">
              <Database size={14} className="flex-shrink-0 text-slate-400" />
              <span>{totalCount} total transactions imported</span>
            </div>
            {accountNames.length > 0 && (
              <div className="flex items-start gap-2.5 text-sm text-slate-600">
                <Building2 size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <span>{accountNames.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
