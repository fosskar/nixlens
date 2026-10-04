import { type ReactNode, useId } from 'react'
import {
  type Disk,
  type Machine,
  type Poll,
  type Pool,
  type PoolGroup,
  type PoolMember,
  type Storage,
  type System,
  formatBytes,
} from './api'

export const glass = 'glass rounded-[28px]'

const card = 'glass-card rounded-2xl'
const bay = 'nos-bay flex flex-wrap gap-x-0.5 gap-y-2 rounded-xl p-1.5'

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <span className="text-[11px] font-semibold tracking-[0.12em] text-fg-muted uppercase">{children}</span>
      {aside && <span className="font-mono text-[11px] text-fg-muted tabular-nums">{aside}</span>}
    </div>
  )
}

function Unavailable({ error, className }: { error?: string; className: string }) {
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

export function MachineSwitcher({
  machines,
  selected,
  onSelect,
}: {
  machines: Machine[]
  selected?: string
  onSelect: (name: string) => void
}) {
  return (
    <div>
      <SectionTitle aside={`${machines.filter((m) => m.online).length}/${machines.length} online`}>
        Machines
      </SectionTitle>
      <div className="flex flex-col gap-1">
        {machines.map((m) => (
          <button
            key={m.name}
            onClick={() => onSelect(m.name)}
            title={m.online ? m.name : `${m.name}: ${m.error || 'offline'}`}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${m.name === selected ? 'glass-accent text-fg-inverse' : 'border-transparent text-fg-muted hover:bg-white/[0.05] hover:text-fg-base'}`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${m.online ? 'bg-success shadow-[0_0_8px_var(--color-success)]' : 'bg-error shadow-[0_0_6px_var(--color-error)]'}`}
            />
            <span className="flex-1 truncate font-medium">{m.name}</span>
            {m.self && <span className="rounded-md border border-accent-cyan/25 bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-cyan">hub</span>}
            {!m.online && <span className="text-[10px] text-error/80">offline</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Ring({ label, value, detail }: { label: string; value: number; detail: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  const gradient = useId()
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90 drop-shadow-[0_0_6px_rgb(26_188_156/0.35)]">
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
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-fg-inverse tabular-nums">
          {Math.round(value)}%
        </span>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-fg-base">{label}</div>
        <div className="text-[11px] whitespace-nowrap text-fg-muted tabular-nums">{detail}</div>
      </div>
    </div>
  )
}

function memoryDetail(system: System): string {
  const total = system.memInstalled || system.memTotal
  return `${formatBytes(system.memTotal - system.memAvailable, true)} / ${formatBytes(total, true)}`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`
}

export function SystemWidget({ poll }: { poll: Poll<System> }) {
  const system = poll.data
  return (
    <div>
      <SectionTitle aside={system && `up ${formatUptime(system.uptimeSec)}`}>System</SectionTitle>
      {system ? (
        <div className={`${card} p-4 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
          <div className="grid grid-cols-2 gap-3">
            <Ring label="CPU" value={system.cpuPercent} detail={`${system.cores} cores / ${system.cpus} threads`} />
            <Ring
              label="Memory"
              value={(100 * (system.memTotal - system.memAvailable)) / system.memTotal}
              detail={memoryDetail(system)}
            />
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-white/[0.07] pt-3 text-[11px]">
            <dt className="text-fg-muted">NixOS</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">{system.nixosVersion}</dd>
            <dt className="text-fg-muted">Kernel</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">{system.kernel}</dd>
            <dt className="text-fg-muted">Load</dt>
            <dd className="truncate text-right font-mono text-fg-base tabular-nums">{system.load.map((l) => l.toFixed(2)).join('  ')}</dd>
            <dt className="text-fg-muted">Swap</dt>
            <dd className="text-right font-mono text-fg-base tabular-nums">
              {system.swaps.length === 0
                ? 'none'
                : system.swaps.map((s) => (
                    <div key={s.device} className="truncate" title={s.device}>
                      <span className="text-fg-muted">{s.kind}</span> {formatBytes(s.used, true)} / {formatBytes(s.size, true)}
                    </div>
                  ))}
            </dd>
          </dl>
        </div>
      ) : (
        <Unavailable error={poll.error} className="h-48" />
      )}
    </div>
  )
}

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

function DriveSlot({ disk, member, health }: { disk?: Disk; member?: PoolMember; health: Health }) {
  const device = member?.device || disk?.name
  const label = disk?.serial || device || 'missing'
  const half = Math.ceil(label.length / 2)
  const lines = label.length > 10 ? [label.slice(0, half), label.slice(half)] : [label]
  const title = [
    disk?.model,
    member?.path || (disk?.id && `/dev/disk/by-id/${disk.id}`),
    device && `/dev/${device}`,
    disk && formatBytes(disk.size),
    member && `${member.state || 'unknown'} · ${member.errors} ${member.errors === 1 ? 'error' : 'errors'}`,
  ]
    .filter(Boolean)
    .join('\n')
  const kind = disk ? disk.transport || (disk.rotational ? 'hdd' : 'ssd') : ''
  return (
    <div className="flex w-[4.25rem] flex-col items-center gap-1.5" title={title}>
      <div
        className={`flex h-14 w-9 flex-col items-center justify-between rounded-md bg-bg-elevated/90 px-1.5 py-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-white/10 ${disk ? '' : 'opacity-50'}`}
      >
        <div className="flex w-full flex-col gap-0.5">
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
          <div className="h-px w-full bg-white/10" />
        </div>
        <span className={`nos-led nos-led-${health}`} />
      </div>
      <div className="w-full text-center leading-tight">
        {lines.map((line, i) => (
          <div key={i} className="truncate font-mono text-[9px] text-fg-base">
            {line}
          </div>
        ))}
        {kind && <div className="text-[8px] tracking-wider text-fg-dim uppercase">{kind}</div>}
      </div>
    </div>
  )
}

function groupLabel(group: PoolGroup): string {
  const n = group.members?.length ?? 0
  const parts = [group.layout || group.name, `${n} ${n === 1 ? 'disk' : 'disks'}`]
  if (group.class && group.class !== 'data') parts.unshift(group.class)
  return parts.join(' · ')
}

function PoolCard({ pool, disks }: { pool: Pool; disks: Disk[] }) {
  const health = poolHealth(pool)
  const scan = scanLine(pool)
  const usedPercent = pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
  const bar = usedPercent >= 90 ? 'from-error/80 to-error' : usedPercent >= 80 ? 'from-warning/80 to-warning' : 'from-accent to-accent-cyan'
  return (
    <div className={`${card} p-3`}>
      <div className="flex items-center gap-2 px-0.5">
        <span className="truncate font-mono text-sm font-semibold text-fg-inverse">{pool.name}</span>
        <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-px text-[10px] font-medium tracking-wide text-fg-muted uppercase">
          {pool.kind}
        </span>
        <span
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${pillStyles[health]}`}
        >
          <span className={`nos-led nos-led-${health} !h-1.5 !w-1.5`} />
          {resilvering(pool) ? 'resilvering' : pool.state || 'unknown'}
        </span>
      </div>
      <div className="mt-3 px-0.5">
        <div className="flex items-baseline justify-between text-[11px] tabular-nums">
          <span className="text-fg-muted">
            <span className="font-medium text-fg-base">{formatCapacity(pool.used)}</span> used of{' '}
            <span className="font-medium text-fg-base">{formatCapacity(pool.usable)}</span>
          </span>
          <span className="font-mono text-fg-muted">{Math.round(usedPercent)}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07] shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${bar} shadow-[0_0_8px_rgb(26_188_156/0.4)] transition-[width] duration-700`}
            style={{ width: `${Math.min(usedPercent, 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-fg-muted tabular-nums">
          {scan && (
            <span className={textStyles[scan.health]}>{scan.text}</span>
          )}
          <span className="ml-auto">{formatCapacity(pool.available)} free</span>
        </div>
      </div>
      {(pool.groups ?? []).map((group) => {
        const groupHealth = stateHealth(group.state)
        return (
          <div key={group.name} className="mt-3 border-t border-white/[0.06] pt-2.5" title={group.name}>
            <div className="mb-2 flex items-center justify-between px-0.5 text-[10px] font-medium tracking-wide text-fg-muted">
              <span>{groupLabel(group)}</span>
              {groupHealth !== 'ok' && group.state && (
                <span className={textStyles[groupHealth]}>{group.state}</span>
              )}
            </div>
            <div className={bay}>
              {(group.members ?? []).map((member, i) => (
                <DriveSlot
                  key={member.device || member.path || i}
                  member={member}
                  disk={disks.find((d) => d.name === member.device)}
                  health={memberHealth(member, pool)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DrivesWidget({ poll }: { poll: Poll<Storage> }) {
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
  const other = disks.filter((d) => !d.pool)
  return (
    <div>
      <SectionTitle aside={`${disks.length} ${disks.length === 1 ? 'disk' : 'disks'}`}>Storage</SectionTitle>
      <div className={`flex flex-col gap-3 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
        {pools.map((pool) => (
          <PoolCard key={`${pool.kind}:${pool.name}`} pool={pool} disks={disks} />
        ))}
        {other.length > 0 && (
          <div className={`${card} p-3`}>
            <div className="mb-2.5 px-0.5 text-sm font-semibold text-fg-inverse">unused</div>
            <div className={bay}>
              {other.map((d) => (
                <DriveSlot key={d.name} disk={d} health="ok" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
