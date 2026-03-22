'use client'

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { useAuthStore } from '@/store/auth'

interface UnlockStatus {
  total: number
  uncategorized: number
  categorized: number
  unlocked: boolean
}

export function useInsightsUnlock() {
  const { apiFetch } = useApi()
  const user = useAuthStore(s => s.user)

  const { data, isLoading } = useQuery<UnlockStatus>({
    queryKey: ['insights-unlock-status'],
    queryFn: () => apiFetch('/api/insights/unlock-status'),
    enabled: !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Poll every 15s while still locked; stop once unlocked
    refetchInterval: (query) => (query.state.data?.unlocked ? false : 15_000),
  })

  return {
    unlocked: data?.unlocked ?? false,
    categorized: data?.categorized ?? 0,
    total: data?.total ?? 0,
    uncategorized: data?.uncategorized ?? 0,
    loading: isLoading,
  }
}
