'use client'

import { useId } from 'react'

interface LogoMarkProps {
  /** Rendered pixel size — component scales cleanly to any value */
  size?: number
  className?: string
}

/**
 * BudgetLens logo mark — magnifying glass with ascending trend line inside.
 * SVG-only, no raster graphics. Scales pixel-perfect from 16px to 128px.
 * Includes a one-shot shimmer sweep on mount (CSS animation).
 */
export function LogoMark({ size = 32, className }: LogoMarkProps) {
  const uid = useId().replace(/:/g, '')

  const lensGradId  = `bl-lens-${uid}`
  const trendGradId = `bl-trend-${uid}`
  const shimGradId  = `bl-shim-${uid}`
  const clipId      = `bl-clip-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Primary blue → purple gradient (lens ring + handle) */}
        <linearGradient id={lensGradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#4F7CFF" />
          <stop offset="100%" stopColor="#8B6FFF" />
        </linearGradient>

        {/* Trend line: lighter blue → soft violet */}
        <linearGradient id={trendGradId} x1="4" y1="14" x2="22" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#7aaaff" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>

        {/* Shimmer sweep gradient */}
        <linearGradient id={shimGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="white" stopOpacity="0"    />
          <stop offset="50%"  stopColor="white" stopOpacity="0.18" />
          <stop offset="100%" stopColor="white" stopOpacity="0"    />
        </linearGradient>

        {/* Clip path — inside the lens ring */}
        <clipPath id={clipId}>
          <circle cx="14" cy="14" r="9.4" />
        </clipPath>
      </defs>

      {/* ── Lens ring ── */}
      <circle
        cx="14" cy="14" r="10"
        stroke={`url(#${lensGradId})`}
        strokeWidth="2"
      />

      {/* ── Trend line (ascending, clipped inside lens) ── */}
      <polyline
        points="5.5,18  8.5,14  12,16  16.5,10  22,7.5"
        stroke={`url(#${trendGradId})`}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Peak dot at the top of the trend ── */}
      <circle
        cx="16.5" cy="10" r="1.4"
        fill="#a78bfa"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Handle ── */}
      <line
        x1="21.5" y1="21.5"
        x2="27.5" y2="27.5"
        stroke={`url(#${lensGradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* ── Shimmer sweep (one-shot on mount, clipped to lens interior) ── */}
      <rect
        x="-32" y="3" width="32" height="22"
        fill={`url(#${shimGradId})`}
        clipPath={`url(#${clipId})`}
        className="bl-shimmer"
        style={{ transformOrigin: '0 0' }}
      />
    </svg>
  )
}
