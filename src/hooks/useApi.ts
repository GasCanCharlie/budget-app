import { useAuthStore } from '@/store/auth'

export function useApi() {
  const token = useAuthStore(s => s.token)

  async function apiFetch(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(path, { ...options, headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  async function apiUpload(path: string, formData: FormData) {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(path, { method: 'POST', body: formData, headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  /** Fetch a file download (e.g. CSV export) and trigger a browser save dialog. */
  async function apiDownload(path: string) {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(path, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    // Extract filename from Content-Disposition header, fall back to path basename
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const match = disposition.match(/filename="?([^";\n]+)"?/)
    const filename = match?.[1] ?? path.split('/').pop() ?? 'download'
    // Trigger browser download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return { apiFetch, apiUpload, apiDownload }
}
