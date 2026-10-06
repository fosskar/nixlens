import { type ReactNode, useId } from 'react'
import { type Health } from '@/lib/health'

export function Led({ health, small, asleep }: { health: Health; small?: boolean; asleep?: boolean }) {
  return (
    <span
      title={asleep ? 'asleep' : undefined}
      className={`nixlens-led nixlens-led-${health} ${small ? 'h-1.5 w-1.5' : ''} ${asleep ? 'nixlens-led-asleep' : ''}`}
    />
  )
}

export function TypeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-px text-[10px] font-medium tracking-wide whitespace-nowrap text-fg-muted">
      {children}
    </span>
  )
}

export function UsageBar({ percent, className }: { percent: number; className: string }) {
  const fill =
    percent >= 90
      ? 'from-error/80 to-error shadow-[0_0_8px_color-mix(in_srgb,var(--color-error)_40%,transparent)]'
      : percent >= 80
        ? 'from-warning/80 to-warning shadow-[0_0_8px_color-mix(in_srgb,var(--color-warning)_40%,transparent)]'
        : 'from-accent to-accent-cyan shadow-[0_0_8px_color-mix(in_srgb,var(--color-accent-cyan)_40%,transparent)]'
  return (
    <div
      className={`overflow-hidden rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] ${className}`}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700 motion-reduce:transition-none`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

export const linkTransition =
  'transition-[opacity,background-color,border-color] duration-200 motion-reduce:transition-none'

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={`${card} grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-[12px]`}>
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-fg-muted">{term}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-fg-base">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export const glass = 'glass rounded-[28px]'

export const card = 'glass-card rounded-2xl'

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <span className="text-[11px] font-semibold tracking-[0.12em] text-fg-muted uppercase">{children}</span>
      {aside && <span className="font-mono text-[11px] text-fg-muted tabular-nums">{aside}</span>}
    </div>
  )
}

export function Unavailable({ error, className }: { error?: string; className: string }) {
  return (
    <div className={`${card} ${className} grid place-items-center p-4 text-center`}>
      {error ? (
        <div>
          <div className="text-sm font-medium text-error">Unavailable</div>
          <div className="mt-1 line-clamp-3 font-mono text-[11px] break-all text-fg-muted">{error}</div>
        </div>
      ) : (
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.08]" />
      )}
    </div>
  )
}

// small rings sit beside their label, as in the overview's machine cards
export function Ring({
  label,
  value,
  detail,
  small,
}: {
  label: string
  value: number
  detail: string
  small?: boolean
}) {
  const r = 26
  const c = 2 * Math.PI * r
  const gradient = useId()
  return (
    <div className={`flex min-w-0 items-center ${small ? 'gap-2.5' : 'flex-col gap-2'}`}>
      <div className={`relative shrink-0 ${small ? 'h-11 w-11' : 'h-16 w-16'}`}>
        <svg
          viewBox="0 0 64 64"
          className="h-full w-full -rotate-90 drop-shadow-[0_0_6px_color-mix(in_srgb,var(--color-accent-cyan)_35%,transparent)]"
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-accent-cyan)" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(value, 100) / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span
          className={`absolute inset-0 grid place-items-center font-semibold text-fg-inverse tabular-nums ${small ? 'text-[11px]' : 'text-sm'}`}
        >
          {Math.round(value)}%
        </span>
      </div>
      <div className={`min-w-0 ${small ? '' : 'text-center'}`}>
        <div className="text-xs font-medium text-fg-base">{label}</div>
        <div className="text-[11px] whitespace-nowrap text-fg-muted tabular-nums">{detail}</div>
      </div>
    </div>
  )
}
