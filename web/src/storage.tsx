import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type Dataset,
  type Disk,
  type Partition,
  type Poll,
  type Pool,
  type PoolDetail,
  type PoolGroup,
  type PoolMember,
  type Storage,
  formatBytes,
  usePoll,
} from './api'
import { SectionTitle, Unavailable, card } from './widgets'

type Health = 'ok' | 'warn' | 'error' | 'unknown'

const pillStyles: Record<Health, string> = {
  ok: 'border-success/30 bg-success/10 text-success',
  warn: 'border-warning/35 bg-warning/10 text-warning',
  error: 'border-error/35 bg-error/10 text-error',
  unknown: 'border-white/10 bg-white/[0.04] text-fg-muted',
}

const textStyles: Record<Health, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
  unknown: 'text-fg-muted',
}

const healthRank: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, error: 3 }

const errorStates = ['faulted', 'offline', 'unavail', 'removed', 'faulty']
const okPoolStates = ['online', 'clean', 'active', 'active-idle', 'read-auto', 'write-pending', 'mounted']

function stateTokens(state: string): string[] {
  return state
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t !== '')
}

function resilvering(pool: Pool): boolean {
  return pool.scan?.function === 'RESILVER' && pool.scan.state === 'SCANNING'
}

function stateHealth(state: string): Health {
  const tokens = stateTokens(state)
  if (tokens.includes('unmounted')) return 'unknown'
  if (tokens.includes('degraded') || tokens.includes('recovering') || tokens.includes('resyncing')) return 'warn'
  if (tokens.length > 0 && tokens.every((t) => okPoolStates.includes(t))) return 'ok'
  return 'error'
}

function poolHealth(pool: Pool): Health {
  const health = stateHealth(pool.state)
  return health === 'ok' && resilvering(pool) ? 'warn' : health
}

function memberHealth(member: PoolMember, pool: Pool): Health {
  const tokens = stateTokens(member.state)
  if (member.device === '' || tokens.some((t) => errorStates.includes(t))) return 'error'
  if (tokens.includes('degraded') || resilvering(pool) || member.errors > 0) return 'warn'
  if (tokens.includes('online') || tokens.includes('in_sync')) return 'ok'
  return 'unknown'
}

function worst(healths: Health[]): Health {
  return healths.reduce<Health>((a, b) => (healthRank[b] > healthRank[a] ? b : a), 'ok')
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(unix: number): string {
  const sec = unix - Date.now() / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(sec) >= size) return relativeTime.format(Math.round(sec / size), unit)
  }
  return 'just now'
}

function shortAgo(unix: number): string {
  const sec = Date.now() / 1000 - unix
  const steps: [string, number][] = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
  ]
  for (const [unit, size] of steps) {
    if (sec >= size) return `${Math.floor(sec / size)}${unit} ago`
  }
  return 'just now'
}

function scanLine(pool: Pool): { text: string; health: Health } | null {
  const scan = pool.scan
  if (!scan) return pool.kind === 'zfs' ? { text: 'never scrubbed', health: 'unknown' } : null
  const resilver = scan.function === 'RESILVER'
  if (scan.state === 'SCANNING') return { text: resilver ? 'resilvering…' : 'scrubbing…', health: 'warn' }
  const errors = `${scan.errors} ${scan.errors === 1 ? 'error' : 'errors'}`
  const health: Health = scan.errors > 0 ? 'error' : 'unknown'
  if (scan.state === 'CANCELED')
    return { text: `${resilver ? 'resilver' : 'scrub'} canceled ${timeAgo(scan.end)} · ${errors}`, health }
  return { text: `${resilver ? 'resilvered' : 'scrubbed'} ${timeAgo(scan.end)} · ${errors}`, health }
}

// one decimal below 100 so pool capacities like "11.5 TB" keep their precision
function formatCapacity(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (bytes >= 1000 && i < units.length - 1) {
    bytes /= 1000
    i++
  }
  return `${bytes.toFixed(bytes < 100 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatUsage(used: number, total: number): string {
  const [usedValue, usedUnit] = formatCapacity(used).split(' ')
  const [totalValue, totalUnit] = formatCapacity(total).split(' ')
  return usedUnit === totalUnit
    ? `${usedValue} / ${totalValue} ${totalUnit}`
    : `${usedValue} ${usedUnit} / ${totalValue} ${totalUnit}`
}

function formatRecordsize(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return value
  return n >= 1048576 ? `${n / 1048576}M` : `${n / 1024}K`
}

function usedPercent(pool: Pool): number {
  return pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
}

function redundant(pool: Pool): boolean {
  return pool.kind === 'zfs' || pool.kind === 'md'
}

function poolType(pool: Pool): string {
  if (!redundant(pool)) return pool.kind
  const layouts = new Set(
    pool.groups
      .filter((g) => g.class === 'data' || g.class === '')
      .map((g) => g.layout)
      .filter((l) => l !== '' && l !== 'single'),
  )
  return layouts.size > 0 ? `${pool.kind} · ${[...layouts].join(' + ')}` : pool.kind
}

function poolDrives(pool: Pool, disks: Disk[]): Set<string> {
  const names = new Set(pool.groups.flatMap((g) => g.members.map((m) => m.device)).filter((d) => d !== ''))
  for (const disk of disks) {
    if ((disk.partitions ?? []).some((p) => p.pool === pool.name)) names.add(disk.name)
  }
  return names
}

function driveHealth(disk: Disk, pools: Pool[]): Health {
  return worst(
    pools
      .filter(redundant)
      .flatMap((p) => p.groups.flatMap((g) => g.members.filter((m) => m.device === disk.name).map((m) => memberHealth(m, p)))),
  )
}

function trailingNumber(name: string): string | undefined {
  return /(\d+)$/.exec(name)?.[1]
}

function memberPartition(member: PoolMember, pool: Pool, disk?: Disk): string {
  const base = member.path.split('/').pop() || member.device
  const candidates = (disk?.partitions ?? []).filter((p) => p.pool === pool.name)
  if (candidates.length === 1) return candidates[0].name
  const number = /-part(\d+)$/.exec(member.path)?.[1]
  return candidates.find((p) => number && trailingNumber(p.name) === number)?.name ?? base
}

function driveTitle(disk: Disk): string {
  return [
    disk.model,
    `/dev/${disk.name}`,
    formatBytes(disk.size),
    ...(disk.partitions ?? []).filter((p) => p.pool).map((p) => `${p.name} → ${p.pool}${p.role ? ` · ${p.role}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n')
}

function Led({ health, small }: { health: Health; small?: boolean }) {
  return <span className={`nos-led nos-led-${health} ${small ? '!h-1.5 !w-1.5' : ''}`} />
}

function TypeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-px text-[10px] font-medium tracking-wide whitespace-nowrap text-fg-muted">
      {children}
    </span>
  )
}

function HealthPill({ pool }: { pool: Pool }) {
  const health = poolHealth(pool)
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${pillStyles[health]}`}
    >
      <Led health={health} small />
      {resilvering(pool) ? 'resilvering' : pool.state || 'unknown'}
    </span>
  )
}

function UsageBar({ percent, className }: { percent: number; className: string }) {
  const fill = percent >= 90 ? 'from-error/80 to-error' : percent >= 80 ? 'from-warning/80 to-warning' : 'from-accent to-accent-cyan'
  return (
    <div className={`overflow-hidden rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)] ${className}`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r ${fill} shadow-[0_0_8px_rgb(26_188_156/0.4)] transition-[width] duration-700 motion-reduce:transition-none`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

function DriveSlot({ disk, health, lit }: { disk: Disk; health: Health; lit?: boolean }) {
  const label = disk.serial || disk.name
  const half = Math.ceil(label.length / 2)
  const lines = label.length > 10 ? [label.slice(0, half), label.slice(half)] : [label]
  const kind = disk.transport || (disk.rotational ? 'hdd' : 'ssd')
  return (
    <div className="flex w-[4.25rem] flex-col items-center gap-1.5">
      <div
        className={`flex h-14 w-9 flex-col items-center justify-between rounded-md bg-bg-elevated/90 px-1.5 py-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 transition-[box-shadow] duration-200 motion-reduce:transition-none ${lit ? 'ring-accent-cyan/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_12px_-2px_rgb(26_188_156/0.55)]' : 'ring-white/10'}`}
      >
        <div className="flex w-full flex-col gap-0.5">
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
        </div>
        <Led health={health} />
      </div>
      <div className="w-full text-center leading-tight">
        {lines.map((line, i) => (
          <div key={i} className="truncate font-mono text-[9px] text-fg-base">
            {line}
          </div>
        ))}
        <div className="text-[8px] tracking-wider text-fg-dim uppercase">{kind}</div>
      </div>
    </div>
  )
}

type Target = { kind: 'pool' | 'disk'; name: string }

const linkTransition = 'transition-[opacity,background-color,border-color] duration-200 motion-reduce:transition-none'

function PoolRow({
  pool,
  lit,
  dim,
  onHover,
  onOpen,
}: {
  pool: Pool
  lit: boolean
  dim: boolean
  onHover: (hovered: boolean) => void
  onOpen: () => void
}) {
  const mounted = redundant(pool) || pool.state === 'mounted'
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={`glass-card w-full rounded-xl px-3 py-2.5 text-left outline-accent-cyan hover:bg-white/[0.07] focus-visible:outline-2 ${linkTransition} ${dim ? 'opacity-35' : ''} ${lit ? 'border-accent-cyan/30 bg-white/[0.07]' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Led health={poolHealth(pool)} />
        <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-fg-inverse">{pool.name}</span>
        <span className="ml-auto">
          <TypeBadge>{poolType(pool)}</TypeBadge>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {mounted ? <UsageBar percent={usedPercent(pool)} className="h-1 flex-1" /> : <span className="flex-1" />}
        <span className="min-w-[7.5rem] shrink-0 text-right font-mono text-[11px] text-fg-muted tabular-nums">
          {mounted ? formatUsage(pool.used, pool.usable) : 'not mounted'}
        </span>
      </div>
    </button>
  )
}

function Modal({ label, focusKey, onClose, children }: { label: string; focusKey: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (e.shiftKey && (current === first || current === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (current === last || !panel.current.contains(current))) {
      e.preventDefault()
      first.focus()
    }
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  useEffect(() => {
    panel.current?.focus()
    panel.current?.querySelector('[data-modal-body]')?.scrollTo({ top: 0 })
  }, [focusKey])

  return createPortal(
    <div
      className="nos-modal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-[6px] md:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="nos-modal glass-strong flex max-h-[min(52rem,calc(100vh-4rem))] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] font-sans text-fg-base outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function ModalHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-white/[0.03] py-3.5 pr-3 pl-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-fg-muted transition outline-accent-cyan hover:bg-white/[0.08] hover:text-fg-inverse focus-visible:outline-2"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

function ModalBody({ children }: { children: ReactNode }) {
  return (
    <div data-modal-body className="flex min-h-0 flex-col gap-6 overflow-y-auto p-5">
      {children}
    </div>
  )
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
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

function UsageSummary({ pool }: { pool: Pool }) {
  const scan = scanLine(pool)
  const percent = usedPercent(pool)
  if (!redundant(pool) && pool.state !== 'mounted') {
    return <div className={`${card} p-4 text-[12px] text-fg-muted`}>Not mounted; usage unavailable.</div>
  }
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-baseline justify-between text-[12px] tabular-nums">
        <span className="text-fg-muted">
          <span className="font-medium text-fg-inverse">{formatCapacity(pool.used)}</span> used of{' '}
          <span className="font-medium text-fg-inverse">{formatCapacity(pool.usable)}</span>
        </span>
        <span className="font-mono text-fg-muted">{Math.round(percent)}%</span>
      </div>
      <UsageBar percent={percent} className="mt-2 h-2" />
      <div className="mt-2 flex justify-between gap-3 text-[11px] text-fg-muted tabular-nums">
        {scan && <span className={textStyles[scan.health]}>{scan.text}</span>}
        <span className="ml-auto">{formatCapacity(pool.available)} free</span>
      </div>
    </div>
  )
}

function MemberRow({
  member,
  pool,
  disk,
  showState,
  onOpenDisk,
}: {
  member: PoolMember
  pool: Pool
  disk?: Disk
  showState: boolean
  onOpenDisk: (name: string) => void
}) {
  const health = memberHealth(member, pool)
  const content = (
    <>
      {showState && <Led health={health} />}
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12px] text-fg-inverse">{disk?.serial || member.device || 'missing'}</span>
        <span className="block truncate text-[10px] text-fg-muted">{disk?.model || member.path}</span>
      </span>
      <span className="font-mono text-[11px] text-fg-muted">{memberPartition(member, pool, disk)}</span>
      {showState && (
        <span className="text-right text-[11px] tabular-nums">
          <span className={textStyles[health]}>{member.device === '' ? 'missing' : member.state || 'unknown'}</span>
          <span className={`block text-[10px] ${member.errors > 0 ? 'text-warning' : 'text-fg-dim'}`}>
            {member.errors} {member.errors === 1 ? 'error' : 'errors'}
          </span>
        </span>
      )}
    </>
  )
  const layout = `relative grid w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left ${showState ? 'grid-cols-[auto_1fr_auto_5.5rem] before:absolute before:top-1/2 before:-left-3 before:h-px before:w-2.5 before:bg-white/10' : 'grid-cols-[1fr_auto]'}`
  if (!disk) return <div className={layout}>{content}</div>
  return (
    <button
      type="button"
      onClick={() => onOpenDisk(disk.name)}
      title={`Show drive ${disk.serial || disk.name}`}
      className={`${layout} outline-accent-cyan transition-colors hover:bg-white/[0.05] focus-visible:outline-2`}
    >
      {content}
    </button>
  )
}

function groupTitle(group: PoolGroup): string {
  return `${group.name} · ${group.class || 'data'}`
}

function VdevTree({ pool, disks, onOpenDisk }: { pool: Pool; disks: Disk[]; onOpenDisk: (name: string) => void }) {
  const groups = pool.groups ?? []
  return (
    <section>
      <SectionTitle aside={`${groups.length} ${groups.length === 1 ? 'vdev' : 'vdevs'}`}>Layout</SectionTitle>
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const health = stateHealth(group.state)
          return (
            <div key={group.name} className={`${card} p-3`}>
              <div className="flex items-center gap-2 px-1 text-[12px]">
                <span className="font-mono font-semibold text-fg-inverse">{groupTitle(group)}</span>
                <span className="text-[11px] text-fg-dim">
                  {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
                </span>
                <span className={`ml-auto text-[10px] font-semibold tracking-wide uppercase ${textStyles[health]}`}>{group.state}</span>
              </div>
              <div className="mt-2 ml-2.5 flex flex-col border-l border-white/10 pl-3">
                {group.members.map((member, i) => (
                  <MemberRow
                    key={member.device || member.path || i}
                    member={member}
                    pool={pool}
                    disk={disks.find((d) => d.name === member.device)}
                    showState
                    onOpenDisk={onOpenDisk}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Chip({ name, value }: { name: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
      <span className="text-fg-muted">{name}</span>
      <span className="font-mono text-fg-inverse">{value}</span>
    </span>
  )
}

function datasetDepth(dataset: Dataset, pool: string): number {
  return dataset.name === pool ? 0 : dataset.name.split('/').length - 1
}

function DatasetRow({ dataset, pool }: { dataset: Dataset; pool: string }) {
  const depth = datasetDepth(dataset, pool)
  const name = depth === 0 ? pool : dataset.name.split('/').pop()
  const limits = [
    dataset.quota > 0 && `quota ${formatCapacity(dataset.quota)}`,
    dataset.reservation > 0 && `reservation ${formatCapacity(dataset.reservation)}`,
  ].filter(Boolean)
  const mount = dataset.mountpoint === 'legacy' || dataset.mountpoint === 'none' || dataset.mountpoint === '-'
  return (
    <tr className="transition-colors hover:bg-white/[0.03]">
      <td className="py-2 pr-3 pl-4" title={dataset.name}>
        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 0.75}rem` }}>
          <span className={`font-mono ${depth === 0 ? 'font-semibold text-fg-inverse' : 'text-fg-base'}`}>{name}</span>
          {dataset.type === 'volume' && <TypeBadge>volume</TypeBadge>}
        </div>
        {limits.length > 0 && (
          <div className="mt-0.5 text-[10px] text-accent-cyan/80" style={{ paddingLeft: `${depth * 0.75}rem` }}>
            {limits.join(' · ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-fg-inverse">{formatCapacity(dataset.used)}</td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatCapacity(dataset.available)}</td>
      <td className="px-3 py-2 text-right font-mono">{dataset.compressRatio}x</td>
      <td className={`max-w-40 truncate px-3 py-2 font-mono ${mount ? 'text-fg-dim' : ''}`} title={dataset.mountpoint}>
        {dataset.mountpoint}
      </td>
      <td
        className="py-2 pr-4 pl-3 text-right whitespace-nowrap"
        title={dataset.snapshots > 0 ? `snapshots use ${formatCapacity(dataset.snapshotsUsed)}` : undefined}
      >
        {dataset.snapshots > 0 ? (
          <>
            <span className="font-mono text-fg-inverse">{dataset.snapshots}</span>
            {dataset.lastSnapshot > 0 && <span className="text-fg-muted"> · latest {shortAgo(dataset.lastSnapshot)}</span>}
          </>
        ) : (
          <span className="text-fg-dim">none</span>
        )}
      </td>
    </tr>
  )
}

function ZfsDetail({ machine, pool }: { machine: string; pool: Pool }) {
  const detail = usePoll<PoolDetail>(
    `/api/machines/${encodeURIComponent(machine)}/pool/${encodeURIComponent(pool.name)}`,
    60000,
  )
  if (!detail.data) {
    return (
      <section>
        <SectionTitle>Properties</SectionTitle>
        {detail.error ? (
          <div className={`${card} p-4 text-[12px]`}>
            <div className="font-medium text-error">Pool details unavailable</div>
            <div className="mt-1 font-mono text-[11px] break-all text-fg-muted">{detail.error}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {[16, 20, 14, 18, 12, 22].map((w, i) => (
                <div key={i} className="h-6 animate-pulse rounded-lg bg-white/[0.06]" style={{ width: `${w * 0.25}rem` }} />
              ))}
            </div>
            <div className={`${card} h-32 animate-pulse`} />
          </div>
        )}
      </section>
    )
  }
  const p = detail.data.properties
  const percent = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? `${v}%` : v)
  const chips: [string, string][] = [
    ['compression', p.compression],
    ['recordsize', formatRecordsize(p.recordsize)],
    ['ashift', p.ashift],
    ['encryption', p.encryption],
    ['atime', p.atime],
    ['autotrim', p.autotrim],
    ['fragmentation', percent(p.fragmentation)],
    ['dedup', `${p.dedupratio}x`],
  ]
  const datasets = detail.data.datasets ?? []
  return (
    <>
      <section>
        <SectionTitle>Properties</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {chips
            .filter(([, value]) => value !== '')
            .map(([name, value]) => (
              <Chip key={name} name={name} value={value} />
            ))}
        </div>
      </section>
      <section>
        <SectionTitle aside={`${datasets.length} ${datasets.length === 1 ? 'dataset' : 'datasets'}`}>Datasets</SectionTitle>
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-[12px] text-fg-base tabular-nums">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10px] tracking-[0.08em] text-fg-muted uppercase">
                <th className="py-2 pr-3 pl-4 text-left font-semibold">Dataset</th>
                <th className="px-3 py-2 text-right font-semibold">Used</th>
                <th className="px-3 py-2 text-right font-semibold">Avail</th>
                <th className="px-3 py-2 text-right font-semibold">Ratio</th>
                <th className="px-3 py-2 text-left font-semibold">Mount</th>
                <th className="py-2 pr-4 pl-3 text-right font-semibold">Snapshots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {datasets.map((d) => (
                <DatasetRow key={d.name} dataset={d} pool={pool.name} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function PoolModal({
  pool,
  disks,
  machine,
  onOpenDisk,
  onClose,
}: {
  pool: Pool
  disks: Disk[]
  machine: string
  onOpenDisk: (name: string) => void
  onClose: () => void
}) {
  const members = pool.groups.flatMap((g) => g.members)
  return (
    <>
      <ModalHeader onClose={onClose}>
        <span className="truncate font-mono text-lg font-semibold text-fg-inverse">{pool.name}</span>
        <TypeBadge>{poolType(pool)}</TypeBadge>
        <span className="ml-auto">
          <HealthPill pool={pool} />
        </span>
      </ModalHeader>
      <ModalBody>
        <UsageSummary pool={pool} />
        {redundant(pool) ? (
          <VdevTree pool={pool} disks={disks} onOpenDisk={onOpenDisk} />
        ) : (
          <>
            <Facts
              rows={[
                ['Type', pool.kind],
                ['Mount point', pool.mount || 'not mounted'],
                ['Size', formatCapacity(pool.raw || pool.usable)],
              ]}
            />
            <section>
              <SectionTitle>Lives on</SectionTitle>
              <div className={`${card} p-2`}>
                {members.map((member, i) => (
                  <MemberRow
                    key={member.path || i}
                    member={member}
                    pool={pool}
                    disk={disks.find((d) => d.name === member.device)}
                    showState={false}
                    onOpenDisk={onOpenDisk}
                  />
                ))}
              </div>
            </section>
          </>
        )}
        {pool.kind === 'zfs' && <ZfsDetail machine={machine} pool={pool} />}
      </ModalBody>
    </>
  )
}

function partitionHealth(partition: Partition, disk: Disk, pools: Pool[]): Health | undefined {
  const pool = pools.find((p) => p.name === partition.pool && redundant(p))
  const members = pool?.groups.flatMap((g) => g.members).filter((m) => m.device === disk.name) ?? []
  return pool && members.length > 0 ? worst(members.map((m) => memberHealth(m, pool))) : undefined
}

function DriveModal({
  disk,
  pools,
  onOpenPool,
  onClose,
}: {
  disk: Disk
  pools: Pool[]
  onOpenPool: (name: string) => void
  onClose: () => void
}) {
  const partitions = disk.partitions ?? []
  return (
    <>
      <ModalHeader onClose={onClose}>
        <span className="flex h-10 w-6 shrink-0 flex-col items-center justify-between rounded-[5px] bg-bg-elevated/90 px-1 py-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-white/10">
          <span className="flex w-full flex-col gap-0.5">
            <span className="h-px w-full bg-white/10" />
            <span className="h-px w-full bg-white/10" />
            <span className="h-px w-full bg-white/10" />
          </span>
          <Led health={driveHealth(disk, pools)} small />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-fg-inverse">{disk.model || disk.name}</span>
          <span className="block truncate font-mono text-[11px] text-fg-muted">{disk.serial}</span>
        </span>
        <span className="ml-auto">
          <TypeBadge>
            {formatBytes(disk.size)} · {disk.rotational ? 'HDD' : 'SSD'}
          </TypeBadge>
        </span>
      </ModalHeader>
      <ModalBody>
        <Facts
          rows={[
            ['Model', disk.model || '—'],
            ['Serial', disk.serial || '—'],
            ['By ID', disk.id ? `/dev/disk/by-id/${disk.id}` : '—'],
            ['Device', `/dev/${disk.name}`],
            ['Size', formatBytes(disk.size)],
            ['Transport', disk.transport || '—'],
            ['Type', disk.rotational ? 'HDD (rotational)' : 'SSD'],
          ]}
        />
        <section>
          <SectionTitle aside={`${partitions.length} ${partitions.length === 1 ? 'partition' : 'partitions'}`}>
            Partitions
          </SectionTitle>
          {partitions.length === 0 ? (
            <div className={`${card} p-4 text-[12px] text-fg-muted`}>No partitions; the drive is unused.</div>
          ) : (
            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-[12px] text-fg-base tabular-nums">
                <thead>
                  <tr className="border-b border-white/[0.07] text-[10px] tracking-[0.08em] text-fg-muted uppercase">
                    <th className="py-2 pr-3 pl-4 text-left font-semibold">Partition</th>
                    <th className="px-3 py-2 text-right font-semibold">Size</th>
                    <th className="px-3 py-2 text-left font-semibold">Filesystem</th>
                    <th className="px-3 py-2 text-left font-semibold">Mount</th>
                    <th className="py-2 pr-4 pl-3 text-left font-semibold">Used by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {partitions.map((partition) => {
                    const target = pools.find((p) => p.name === partition.pool)
                    const health = partitionHealth(partition, disk, pools)
                    return (
                      <tr key={partition.name} className={partition.pool ? '' : 'opacity-45'}>
                        <td className="py-2 pr-3 pl-4 font-mono whitespace-nowrap text-fg-inverse">{partition.name}</td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatBytes(partition.size)}</td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {partition.fstype || <span className="text-fg-dim">—</span>}
                          {partition.label && <span className="text-fg-muted"> · {partition.label}</span>}
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {partition.mount || <span className="text-fg-dim">—</span>}
                        </td>
                        <td className="py-1.5 pr-3 pl-1.5 whitespace-nowrap">
                          {target ? (
                            <button
                              type="button"
                              onClick={() => onOpenPool(target.name)}
                              className="flex items-center gap-2 rounded-lg px-1.5 py-0.5 text-left outline-accent-cyan transition-colors hover:bg-white/[0.06] focus-visible:outline-2"
                            >
                              {health && <Led health={health} small />}
                              <span className="text-accent-cyan">→</span>
                              <span className="font-mono text-fg-inverse">{target.name}</span>
                              {partition.role && <span className="text-fg-muted">· {partition.role}</span>}
                            </button>
                          ) : (
                            <span className="px-1.5 text-fg-dim">{partition.pool || 'unassigned'}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </ModalBody>
    </>
  )
}

function SubTitle({ children, aside }: { children: ReactNode; aside: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-1 text-[10px] font-medium tracking-[0.1em] text-fg-dim uppercase">
      {children}
      <span className="tabular-nums">{aside}</span>
      <span className="h-px flex-1 self-center bg-gradient-to-r from-white/[0.08] to-transparent" />
    </div>
  )
}

export function DrivesWidget({ poll, machine }: { poll: Poll<Storage>; machine: string }) {
  const [hover, setHover] = useState<Target | null>(null)
  const [open, setOpen] = useState<Target | null>(null)
  const storage = poll.data
  if (!storage) {
    return (
      <div>
        <SectionTitle>Storage</SectionTitle>
        <Unavailable error={poll.error} className="h-28" />
      </div>
    )
  }
  const pools = storage.pools ?? []
  const disks = storage.disks ?? []
  const links = new Map(pools.map((p) => [p.name, poolDrives(p, disks)]))
  const litDisks =
    hover?.kind === 'pool' ? (links.get(hover.name) ?? new Set<string>()) : hover?.kind === 'disk' ? new Set([hover.name]) : null
  const litPools =
    hover?.kind === 'disk'
      ? new Set(pools.filter((p) => links.get(p.name)?.has(hover.name)).map((p) => p.name))
      : hover?.kind === 'pool'
        ? new Set([hover.name])
        : null
  const hoverHandler = (target: Target) => (hovered: boolean) =>
    setHover((h) => (hovered ? target : h?.kind === target.kind && h.name === target.name ? null : h))

  const openPool = open?.kind === 'pool' ? pools.find((p) => p.name === open.name) : undefined
  const openDisk = open?.kind === 'disk' ? disks.find((d) => d.name === open.name) : undefined
  const close = () => setOpen(null)

  return (
    <div>
      <SectionTitle aside={`${disks.length} ${disks.length === 1 ? 'drive' : 'drives'}`}>Storage</SectionTitle>
      <div className={`flex flex-col gap-4 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
        {pools.length > 0 && (
          <div>
            <SubTitle aside={String(pools.length)}>Pools</SubTitle>
            <div className="flex flex-col gap-1.5">
              {pools.map((pool) => (
                <PoolRow
                  key={`${pool.kind}:${pool.name}`}
                  pool={pool}
                  lit={litPools?.has(pool.name) ?? false}
                  dim={litPools !== null && !litPools.has(pool.name)}
                  onHover={hoverHandler({ kind: 'pool', name: pool.name })}
                  onOpen={() => setOpen({ kind: 'pool', name: pool.name })}
                />
              ))}
            </div>
          </div>
        )}
        {disks.length > 0 && (
          <div>
            <SubTitle aside={String(disks.length)}>Drives</SubTitle>
            <div className="nos-bay grid grid-cols-4 justify-items-center gap-y-1 rounded-xl p-1.5">
              {disks.map((disk) => {
                const lit = litDisks?.has(disk.name) ?? false
                const onHover = hoverHandler({ kind: 'disk', name: disk.name })
                return (
                  <button
                    key={disk.name}
                    type="button"
                    title={driveTitle(disk)}
                    onClick={() => setOpen({ kind: 'disk', name: disk.name })}
                    onMouseEnter={() => onHover(true)}
                    onMouseLeave={() => onHover(false)}
                    onFocus={() => onHover(true)}
                    onBlur={() => onHover(false)}
                    className={`self-start rounded-lg py-1.5 outline-accent-cyan hover:bg-white/[0.04] focus-visible:outline-2 ${linkTransition} ${litDisks !== null && !lit ? 'opacity-35' : ''}`}
                  >
                    <DriveSlot disk={disk} health={driveHealth(disk, pools)} lit={lit} />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {(openPool || openDisk) && (
        <Modal
          label={openPool ? `Pool ${openPool.name}` : `Drive ${openDisk?.serial || openDisk?.name}`}
          focusKey={`${open?.kind}:${open?.name}`}
          onClose={close}
        >
          {openPool && (
            <PoolModal
              pool={openPool}
              disks={disks}
              machine={machine}
              onOpenDisk={(name) => setOpen({ kind: 'disk', name })}
              onClose={close}
            />
          )}
          {openDisk && (
            <DriveModal
              disk={openDisk}
              pools={pools}
              onOpenPool={(name) => setOpen({ kind: 'pool', name })}
              onClose={close}
            />
          )}
        </Modal>
      )}
    </div>
  )
}
