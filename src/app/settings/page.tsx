'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import {
  Lock, Trash2, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff,
} from 'lucide-react'

export default function SettingsPage() {
  const router = useRouter()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const { apiFetch } = useApi()

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwPending, setPwPending] = useState(false)
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwError, setPwError] = useState('')

  // Delete account state
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeletePw, setShowDeletePw] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (!user) router.push('/login')
  }, [user, router])

  if (!user) return null

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    setPwSuccess('')

    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }

    setPwPending(true)
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      setPwSuccess('Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password.')
    } finally {
      setPwPending(false)
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault()
    setDeleteError('')
    setDeletePending(true)
    try {
      await apiFetch('/api/auth/delete-account', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      })
      logout()
      router.push('/login')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account.')
      setDeletePending(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 40px 10px 12px',
    borderRadius: 10,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--muted)',
    marginBottom: 6,
  }

  const fieldWrapStyle: React.CSSProperties = {
    position: 'relative',
    marginBottom: 16,
  }

  const toggleBtnStyle: React.CSSProperties = {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    padding: 0,
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 672, margin: '0 auto', padding: '32px 16px 96px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 24 }}>
          Settings
        </h1>

        {/* ── Change Password ─────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <Lock size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Change Password</span>
          </div>

          <form onSubmit={handleChangePassword}>
            {/* Current Password */}
            <div style={fieldWrapStyle}>
              <label style={labelStyle}>Current Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  style={toggleBtnStyle}
                  onClick={() => setShowCurrent(v => !v)}
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div style={fieldWrapStyle}>
              <label style={labelStyle}>New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  style={toggleBtnStyle}
                  onClick={() => setShowNew(v => !v)}
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div style={fieldWrapStyle}>
              <label style={labelStyle}>Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  style={inputStyle}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  style={toggleBtnStyle}
                  onClick={() => setShowConfirm(v => !v)}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Feedback */}
            {pwSuccess && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 13, marginBottom: 12 }}>
                <CheckCircle2 size={14} />
                {pwSuccess}
              </div>
            )}
            {pwError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
                <AlertCircle size={14} />
                {pwError}
              </div>
            )}

            <button
              type="submit"
              disabled={pwPending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 20px',
                borderRadius: 10,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                fontSize: 14,
                fontWeight: 600,
                cursor: pwPending ? 'not-allowed' : 'pointer',
                opacity: pwPending ? 0.7 : 1,
              }}
            >
              {pwPending && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
              Update Password
            </button>
          </form>
        </div>

        {/* ── Danger Zone ─────────────────────────────────────────────────── */}
        <div
          style={{
            ...cardStyle,
            border: '1px solid rgba(248,113,113,0.3)',
            background: 'rgba(248,113,113,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Trash2 size={14} style={{ color: 'var(--danger)' }} />
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--danger)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Danger Zone
            </span>
          </div>

          <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
            Permanently delete your account and all associated data — statements, transactions,
            categories, rules, and insights. This action cannot be undone.
          </p>

          {!showDeleteForm ? (
            <button
              onClick={() => setShowDeleteForm(true)}
              style={{
                padding: '9px 18px',
                borderRadius: 10,
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                background: 'transparent',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Delete My Account
            </button>
          ) : (
            <form onSubmit={handleDeleteAccount}>
              <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 14, lineHeight: 1.6 }}>
                This will permanently delete your account and all associated data. This cannot be undone.
              </p>

              <div style={{ ...fieldWrapStyle, marginBottom: 16 }}>
                <label style={labelStyle}>Confirm your password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showDeletePw ? 'text' : 'password'}
                    value={deletePassword}
                    onChange={e => setDeletePassword(e.target.value)}
                    style={inputStyle}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    style={toggleBtnStyle}
                    onClick={() => setShowDeletePw(v => !v)}
                    tabIndex={-1}
                  >
                    {showDeletePw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {deleteError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
                  <AlertCircle size={14} />
                  {deleteError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => { setShowDeleteForm(false); setDeletePassword(''); setDeleteError('') }}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    background: 'transparent',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletePending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 18px',
                    borderRadius: 10,
                    background: 'var(--danger)',
                    color: '#fff',
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: deletePending ? 'not-allowed' : 'pointer',
                    opacity: deletePending ? 0.7 : 1,
                  }}
                >
                  {deletePending && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                  Delete permanently
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </AppShell>
  )
}
