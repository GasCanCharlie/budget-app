import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'

export type StageState = 'done' | 'active' | 'todo' | 'error'

export type Stage = {
  label: string
  state: StageState
  detail?: string
}

export function ProcessingStages({
  etaSeconds,
  stages,
}: {
  etaSeconds?: number
  stages: Stage[]
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Processing statement</div>
        <div className="text-xs text-slate-500">
          {etaSeconds ? `Estimated time: ${etaSeconds}s` : 'Estimating…'}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {stages.map((s) => (
          <div key={s.label} className="flex items-start gap-3">
            {s.state === 'done' ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : s.state === 'active' ? (
              <Loader2 className="h-4 w-4 text-blue-600 mt-0.5 animate-spin flex-shrink-0" />
            ) : s.state === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            ) : (
              <div className="h-4 w-4 rounded-full border-2 border-slate-300 mt-0.5 flex-shrink-0" />
            )}

            <div className="flex-1 min-w-0">
              <div
                className={
                  s.state === 'done'
                    ? 'text-sm text-slate-700'
                    : s.state === 'active'
                    ? 'text-sm font-semibold text-slate-900'
                    : s.state === 'error'
                    ? 'text-sm font-semibold text-red-700'
                    : 'text-sm text-slate-400'
                }
              >
                {s.label}
              </div>
              {s.detail ? (
                <div className="text-xs text-slate-500 mt-0.5">{s.detail}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
