'use client'

import Link from 'next/link'
import { ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react'

interface UploadInfo {
  id: string
  filename: string
  account: { name: string }
  rowCountAccepted: number
  createdAt: string
  reconciliationStatus: string // 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL' | 'UNVERIFIABLE' | 'PENDING'
  totalRowsUnresolved: number
}

interface Props {
  latestUpload: UploadInfo | undefined
  alertCount: number
  txCount: number
}

type Grade = 'A' | 'B' | 'C' | 'D'

interface GradeInfo {
  grade: Grade
  label: string
  color: 'green' | 'blue' | 'amber' | 'red'
}

function computeGrade(reconciliationStatus: string, alertCount: number): GradeInfo {
  if (reconciliationStatus === 'PASS' && alertCount === 0) {
    return { grade: 'A', label: 'Audit-ready', color: 'green' }
  }
  if (reconciliationStatus === 'PASS' && alertCount <= 2) {
    return { grade: 'B', label: 'Verified with notes', color: 'blue' }
  }
  if (reconciliationStatus === 'PASS_WITH_WARNINGS' && alertCount <= 2) {
    return { grade: 'B', label: 'Verified with notes', color: 'blue' }
  }
  if (
    (reconciliationStatus === 'PASS' || reconciliationStatus === 'PASS_WITH_WARNINGS') &&
    alertCount > 2
  ) {
    return { grade: 'C', label: 'Review recommended', color: 'amber' }
  }
  if (reconciliationStatus === 'FAIL') {
    return { grade: 'D', label: 'Action required', color: 'red' }
  }
  return { grade: 'B', label: 'No discrepancies', color: 'blue' }
}

const gradeBoxClasses: Record<GradeInfo['color'], string> = {
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
}

interface StatusPillConfig {
  label: string
  classes: string
  icon: 'shield' | 'check' | 'alert'
}

function getStatusPillConfig(reconciliationStatus: string): StatusPillConfig {
  switch (reconciliationStatus) {
    case 'PASS':
      return { label: 'Balanced', classes: 'bg-green-100 text-green-700', icon: 'shield' }
    case 'PASS_WITH_WARNINGS':
      return { label: 'Balanced*', classes: 'bg-blue-100 text-blue-700', icon: 'check' }
    case 'FAIL':
      return { label: 'Discrepancy', classes: 'bg-red-100 text-red-700', icon: 'alert' }
    case 'UNVERIFIABLE':
      return { label: 'Unverifiable', classes: 'bg-slate-100 text-slate-600', icon: 'alert' }
    default:
      return { label: 'Pending', classes: 'bg-slate-100 text-slate-500', icon: 'alert' }
  }
}

function StatusPillIcon({ icon }: { icon: StatusPillConfig['icon'] }) {
  if (icon === 'shield') return <ShieldCheck size={12} />
  if (icon === 'check') return <CheckCircle2 size={12} />
  return <AlertTriangle size={12} />
}

export function StatementStatus({ latestUpload, alertCount, txCount }: Props) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Statement Health
        </span>
        {latestUpload && (
          <Link
            href={`/upload/${latestUpload.id}`}
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
          >
            View detail →
          </Link>
        )}
      </div>

      {/* Empty state */}
      {!latestUpload ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-slate-400">No statements uploaded yet.</p>
          <Link
            href="/upload"
            className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Upload now
          </Link>
        </div>
      ) : (
        <>
          {/* Grade row */}
          {(() => {
            const gradeInfo = computeGrade(latestUpload.reconciliationStatus, alertCount)
            const pillConfig = getStatusPillConfig(latestUpload.reconciliationStatus)
            const boxClass = gradeBoxClasses[gradeInfo.color]

            return (
              <div className="flex items-center gap-4 mb-4">
                {/* Grade box */}
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-xl font-bold ${boxClass}`}
                >
                  {gradeInfo.grade}
                </div>

                {/* Grade label + status pill + alert count */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate-700">{gradeInfo.label}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Reconciliation status pill */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pillConfig.classes}`}
                    >
                      <StatusPillIcon icon={pillConfig.icon} />
                      {pillConfig.label}
                    </span>

                    {/* Alert count pill */}
                    {alertCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <AlertTriangle size={12} />
                        {alertCount} {alertCount === 1 ? 'alert' : 'alerts'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Stat chips row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Transactions */}
            <div className="flex flex-col items-center rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">Transactions</span>
              <span className="text-sm font-semibold text-slate-700 tabular-nums">
                {txCount.toLocaleString()}
              </span>
            </div>

            {/* Unresolved */}
            <div className="flex flex-col items-center rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">Unresolved</span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  latestUpload.totalRowsUnresolved > 0 ? 'text-orange-500' : 'text-slate-700'
                }`}
              >
                {latestUpload.totalRowsUnresolved.toLocaleString()}
              </span>
            </div>

            {/* Alerts */}
            <div className="flex flex-col items-center rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">Alerts</span>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  alertCount > 0 ? 'text-amber-500' : 'text-slate-700'
                }`}
              >
                {alertCount.toLocaleString()}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
