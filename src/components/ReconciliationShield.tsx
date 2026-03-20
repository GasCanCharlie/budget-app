import { ShieldCheck, ShieldAlert, ShieldX, ShieldOff, Shield, type LucideIcon } from 'lucide-react'

interface Props {
  status: string
  size?: 'sm' | 'md'
  discrepancy?: string
}

const CONFIG: Record<string, {
  Icon: LucideIcon
  color: string
  label: string
  tooltip: string
}> = {
  PASS: {
    Icon: ShieldCheck,
    color: 'text-green-700 bg-green-100 border-green-200',
    label: 'Verified',
    tooltip: 'Totals match bank statement',
  },
  PASS_WITH_WARNINGS: {
    Icon: ShieldAlert,
    color: 'text-amber-700 bg-amber-100 border-amber-200',
    label: 'Verified*',
    tooltip: 'Minor issues found — see details',
  },
  FAIL: {
    Icon: ShieldX,
    color: 'text-red-700 bg-red-100 border-red-200',
    label: 'Discrepancy',
    tooltip: "Totals don't match bank statement",
  },
  UNVERIFIABLE: {
    Icon: ShieldOff,
    color: 'text-slate-500 bg-slate-100 border-slate-200',
    label: 'Unverified',
    tooltip: 'This export has no running balance column or statement totals — automatic verification isn\'t possible for this file format',
  },
  PENDING: {
    Icon: Shield,
    color: 'text-blue-600 bg-blue-100 border-blue-200',
    label: 'Pending',
    tooltip: 'Reconciliation in progress',
  },
}

export function ReconciliationShield({ status, size = 'sm', discrepancy }: Props) {
  const cfg = CONFIG[status] ?? CONFIG.PENDING
  const { Icon, color, label, tooltip } = cfg

  if (size === 'md') {
    return (
      <span
        title={tooltip}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold flex-shrink-0 ${color}`}
      >
        <Icon size={14} />
        {label}
        {discrepancy && status === 'FAIL' && (
          <span className="ml-0.5 opacity-80">· {discrepancy}</span>
        )}
      </span>
    )
  }

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs font-semibold ${color}`}
    >
      <Icon size={12} />
      {label}
    </span>
  )
}
