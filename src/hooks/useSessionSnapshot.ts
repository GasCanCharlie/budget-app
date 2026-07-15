'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'

export interface SessionSnapshot {
  sessionId:          string
  status:             string
  title:              string
  uploadCount:        number
  txCount:            number
  uncategorizedCount: number
  transferCount:      number
  excludedCount:      number
  accountCount:       number
  dateRangeStart:     string | null
  dateRangeEnd:       string | null
  monthsLoaded:       number
  hasData:            boolean
  accounts: Array<{
    id:          string
    name:        string
    accountType: string
    institution: string
  }>
}

export const SESSION_SNAPSHOT_KEY = ['session-snapshot'] as const

export function useSessionSnapshot() {
  const { apiFetch } = useApi()
  return useQuery<{ snapshot: SessionSnapshot | null }>({
    queryKey:       SESSION_SNAPSHOT_KEY,
    queryFn:        () => apiFetch('/api/sessions/snapshot'),
    staleTime:      30_000,
    refetchOnMount: 'always',
  })
}

// Call this to bust the snapshot cache after any upload or archive action.
export function useInvalidateSnapshot() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: SESSION_SNAPSHOT_KEY })
}
