import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg, #0b1020)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'var(--font-inter, sans-serif)',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px', textDecoration: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7c91ff,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LogoMark size={22} />
        </div>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#eaf0ff' }}>BudgetLens</span>
      </Link>

      <div style={{
        background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(255,255,255,.10)',
        borderRadius: '20px',
        padding: '48px 40px',
        maxWidth: '440px',
        width: '100%',
        textAlign: 'center',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{ fontSize: '64px', marginBottom: '16px', lineHeight: 1 }}>404</div>
        <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 800, color: '#eaf0ff' }}>
          Page not found
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: '14px', color: '#a8b3d6', lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/dashboard" style={{
            padding: '10px 20px', borderRadius: '10px',
            background: '#3b82f6', color: '#fff',
            fontSize: '14px', fontWeight: 600, textDecoration: 'none',
          }}>
            Go to dashboard
          </Link>
          <Link href="/" style={{
            padding: '10px 20px', borderRadius: '10px',
            border: '1px solid rgba(255,255,255,.15)', color: '#a8b3d6',
            fontSize: '14px', fontWeight: 600, textDecoration: 'none',
          }}>
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
