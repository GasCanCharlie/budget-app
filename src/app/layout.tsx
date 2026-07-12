import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://financialautopsy.com'

export const metadata: Metadata = {
  title: 'Financial Autopsy — Know Where Your Money Went',
  description: 'Upload your bank statements and get instant spending breakdowns, money personality insights, and financial analysis. Privacy-first — no bank login required.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
  metadataBase: new URL(APP_URL),
  openGraph: {
    title:       'Financial Autopsy — Know Where Your Money Went',
    description: 'Upload your bank statements and get instant spending breakdowns, money personality insights, and financial analysis. Privacy-first — no bank login required.',
    url:         APP_URL,
    siteName:    'Financial Autopsy',
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Financial Autopsy — Know Where Your Money Went',
    description: 'Upload your bank statements and get instant spending breakdowns, money personality insights, and financial analysis. Privacy-first — no bank login required.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
  (function(){
    var t = localStorage.getItem('bl-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  })();
` }} />
      </head>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
