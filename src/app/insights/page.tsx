'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { AiInsightsPanel } from '@/components/dashboard/AiInsightsPanel'

export default function InsightsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const autoNavigated = useRef(false)

  useEffect(() => {
    if (!user) router.replace('/login')
  }, [user, router])

  const { data } = useQuery<{ availableMonths: { year: number; month: number }[] }>({
    queryKey: ['summary', year, month],
    queryFn: () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled: !!user,
    refetchOnMount: 'always',
  })

  const availableMonths = data?.availableMonths ?? []

  useEffect(() => {
    if (availableMonths.length === 0) return
    const latest = availableMonths[0]
    if (!latest) return
    if (!autoNavigated.current) {
      setYear(latest.year)
      setMonth(latest.month)
      autoNavigated.current = true
    }
  }, [availableMonths])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }, [])

  if (!user) return null

  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-5 pb-24">
        <AiInsightsPanel year={year} month={month} />
      </div>
    </AppShell>
  )
}
