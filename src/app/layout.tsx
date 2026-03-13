import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://budgetapp-j00dr8m7n-gascancharlies-projects.vercel.app'

export const metadata: Metadata = {
  title: 'BudgetLens — Financial Statement Intelligence',
  description: 'Upload your bank statements and get instant spending breakdowns, trends, and financial health scores. Privacy-first — no bank login required.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
  metadataBase: new URL(APP_URL),
  openGraph: {
    title:       'BudgetLens — Financial Statement Intelligence',
    description: 'Upload your bank statements and get instant spending breakdowns, trends, and financial health scores. Privacy-first — no bank login required.',
    url:         APP_URL,
    siteName:    'BudgetLens',
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'BudgetLens — Financial Statement Intelligence',
    description: 'Upload your bank statements and get instant spending breakdowns, trends, and financial health scores. Privacy-first — no bank login required.',
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
