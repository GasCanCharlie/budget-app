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

        {/* Dollar sign fill: lighter blue → soft violet */}
        <linearGradient id={trendGradId} x1="9" y1="7" x2="19" y2="21" gradientUnits="userSpaceOnUse">
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

      {/* ── Dollar sign vertical stroke ── */}
      <line
        x1="14" y1="4.5"
        x2="14" y2="23.5"
        stroke={`url(#${trendGradId})`}
        strokeWidth="1.6"
        strokeLinecap="round"
        clipPath={`url(#${clipId})`}
      />

      {/* ── Dollar sign S-curve ── */}
      <path
        d="M 18,9.5 C 18,7.8 16.5,7 14,7 C 11.5,7 9.5,8.2 9.5,10.5 C 9.5,12.8 12,13.2 14,14 C 16,14.8 18.5,15.5 18.5,18 C 18.5,20.2 16.5,21.5 14,21.5 C 11.5,21.5 9.5,20.2 9.5,18.5"
        stroke={`url(#${trendGradId})`}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
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
