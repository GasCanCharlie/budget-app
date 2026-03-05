'use client'

interface LogoMarkProps {
  size?: number
  className?: string
}

/**
 * BudgetLens logo mark — radar sweep design.
 * Continuous rotating sweep animation, scales cleanly from 16px to 128px.
 */
export function LogoMark({ size = 32, className }: LogoMarkProps) {
  // Scale the 128-viewBox design down to the requested size
  const scale = size / 128

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <style>{`
        @keyframes bl-radar-sweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .bl-radar-sweep {
          transform-origin: 64px 64px;
          animation: bl-radar-sweep 12s linear infinite;
        }
      `}</style>

      {/* Background rounded square */}
      <rect x="8" y="8" width="112" height="112" rx="28" fill="#0F1B36" />

      {/* Outer radar ring — fits just inside the background rect (r=52, inset 4px) */}
      <circle cx="64" cy="64" r="52" stroke="#6EA8FF" strokeWidth="3" fill="none" />

      {/* Inner radar ring */}
      <circle cx="64" cy="64" r="32" stroke="#6EA8FF" strokeWidth="2" opacity="0.6" fill="none" />

      {/* Radar sweep — rotates continuously */}
      <path
        className="bl-radar-sweep"
        d="M64 64 L116 64 A52 52 0 0 0 64 12 Z"
        fill="#6EA8FF"
        opacity="0.30"
      />

      {/* Center node */}
      <circle cx="64" cy="64" r="5" fill="#6EA8FF" />
    </svg>
  )
}
