'use client'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // Read persisted or system preference on mount
    const stored = localStorage.getItem('bl-theme') as 'dark' | 'light' | null
    const preferred = stored ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    setTheme(preferred)
    document.documentElement.setAttribute('data-theme', preferred)
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('bl-theme', next)
  }

  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        background: 'transparent',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text3)',
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      {theme === 'dark'
        ? <Sun size={14} />
        : <Moon size={14} />
      }
    </button>
  )
}
