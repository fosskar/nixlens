import { type Disk, type Machine, type Poll, type Pool, type Storage, type System, formatBytes } from './api'
import { type Health, driveHealth, formatCapacity, poolHealth } from './health'
import { Led, type Target } from './storage'
import { SectionTitle, Unavailable, card } from './widgets'

export type MachineOverview = Machine & { system?: System; storage?: Storage }

type Attention = { machine: string; health: Health; text: string; target?: Target }

const fullAt = 90

function usedPercent(pool: Pool): number {
  return pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
}

function driveProblem(disk: Disk): string {
  const s = disk.smart
  if (s?.passed === false) return 'SMART failed'
  const parts = [
    s?.reallocated && `${s.reallocated} reallocated sectors`,
    s?.pending && `${s.pending} pending sectors`,
    s?.uncorrectable && `${s.uncorrectable} uncorrectable`,
    s?.criticalWarning && 'critical warning',
    s?.mediaErrors && `${s.mediaErrors} media errors`,
    s && s.percentageUsed >= 90 && `${s.percentageUsed} % worn`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'errors in its pool'
}

// everything that needs a look, worst first
function attention(machines: MachineOverview[]): Attention[] {
  const items: Attention[] = []
  for (const m of machines) {
    if (!m.online) {
      items.push({ machine: m.name, health: 'error', text: 'offline' })
      continue
    }
    const pools = m.storage?.pools ?? []
    for (const pool of pools) {
      const health = poolHealth(pool)
      if (health === 'warn' || health === 'error') {
        items.push({
          machine: m.name,
          health,
          text: `${pool.name} is ${pool.state.toLowerCase()}`,
          target: { kind: 'pool', name: pool.name },
        })
      } else if (pool.state !== 'unmounted' && usedPercent(pool) >= fullAt) {
        items.push({
          machine: m.name,
          health: 'warn',
          text: `${pool.name} is ${Math.round(usedPercent(pool))} % full`,
          target: { kind: 'pool', name: pool.name },
        })
      }
    }
    for (const disk of m.storage?.disks ?? []) {
      const health = driveHealth(disk, pools)
      if (health === 'warn' || health === 'error') {
        items.push({
          machine: m.name,
          health,
          text: `${disk.serial || disk.name}: ${driveProblem(disk)}`,
          target: { kind: 'disk', name: disk.name },
        })
      }
    }
  }
  return items.sort((a, b) => (a.health === b.health ? 0 : a.health === 'error' ? -1 : 1))
}

function storageHealth(m: MachineOverview): Health {
  if (!m.storage) return 'unknown'
  const pools = m.storage.pools ?? []
  const healths = [...pools.map(poolHealth), ...(m.storage.disks ?? []).map((d) => driveHealth(d, pools))]
  return healths.includes('error') ? 'error' : healths.includes('warn') ? 'warn' : 'ok'
}

function Bar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${Math.round(percent)} %`}>
      <span className="w-7 text-[10px] text-fg-muted">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={`h-full rounded-full ${percent >= fullAt ? 'bg-warning' : 'bg-gradient-to-r from-accent to-accent-cyan'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  )
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  return d > 0 ? `${d}d` : `${Math.floor(sec / 3600)}h`
}

function MachineRow({ m, onSelect }: { m: MachineOverview; onSelect: () => void }) {
  const s = m.system
  return (
    <button
      type="button"
      onClick={onSelect}
      title={m.online ? `Show ${m.name}` : `${m.name}: ${m.error || 'offline'}`}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition outline-accent-cyan hover:bg-white/[0.06] focus-visible:outline-2"
    >
      <Led health={m.online ? 'ok' : 'error'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-fg-inverse">{m.name}</span>
          {m.self && <span className="text-[10px] text-accent-cyan">hub</span>}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
            {s ? `up ${uptime(s.uptimeSec)}` : 'offline'}
          </span>
        </div>
        {s && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-3">
            <Bar label="CPU" percent={s.cpuPercent} />
            <Bar label="RAM" percent={(100 * (s.memTotal - s.memAvailable)) / s.memTotal} />
          </div>
        )}
      </div>
      <span title={`storage ${storageHealth(m)}`}>
        <Led health={storageHealth(m)} small />
      </span>
    </button>
  )
}

export function OverviewWidget({
  poll,
  onSelect,
}: {
  poll: Poll<MachineOverview[]>
  onSelect: (machine: string, target?: Target) => void
}) {
  const machines = poll.data
  if (!machines) return <Unavailable error={poll.error} className="h-48" />

  const items = attention(machines)
  const pools = machines.flatMap((m) => m.storage?.pools ?? []).filter((p) => p.state !== 'unmounted')
  const disks = machines.flatMap((m) => (m.storage?.disks ?? []).map((d) => ({ d, pools: m.storage?.pools ?? [] })))
  const usable = pools.reduce((sum, p) => sum + p.usable, 0)
  const used = pools.reduce((sum, p) => sum + p.used, 0)
  const drives = { ok: 0, warn: 0, error: 0, asleep: 0 }
  // each drive counts once: problems first, then asleep, then healthy
  for (const { d, pools } of disks) {
    const h = driveHealth(d, pools)
    if (h === 'error') drives.error++
    else if (h === 'warn') drives.warn++
    else if (d.smart?.standby) drives.asleep++
    else drives.ok++
  }

  return (
    <div className={`flex flex-col gap-7 ${poll.error ? 'opacity-50' : ''}`} title={poll.error}>
      {items.length > 0 && (
        <div>
          <SectionTitle aside={String(items.length)}>Attention</SectionTitle>
          <div className={`${card} p-1.5`}>
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(item.machine, item.target)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition outline-accent-cyan hover:bg-white/[0.06] focus-visible:outline-2"
              >
                <Led health={item.health} />
                <span className="min-w-0 flex-1 truncate text-fg-base">{item.text}</span>
                <span className="shrink-0 text-[11px] text-fg-muted">{item.machine}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle aside={`${machines.filter((m) => m.online).length}/${machines.length} online`}>
          Machines
        </SectionTitle>
        <div className={`${card} p-1.5`}>
          {machines.map((m) => (
            <MachineRow key={m.name} m={m} onSelect={() => onSelect(m.name)} />
          ))}
        </div>
      </div>

      <div>
        <SectionTitle aside={`${disks.length} drives`}>Storage</SectionTitle>
        <div className={`${card} p-4`}>
          <div className="flex items-baseline justify-between text-[11px] text-fg-muted tabular-nums">
            <span>
              <span className="font-medium text-fg-base">{formatCapacity(used)}</span> used of{' '}
              <span className="font-medium text-fg-base">{formatCapacity(usable)}</span>
            </span>
            <span className="font-mono">{usable > 0 ? Math.round((100 * used) / usable) : 0}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan"
              style={{ width: `${usable > 0 ? Math.min((100 * used) / usable, 100) : 0}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
            <span>{pools.length} pools</span>
            <span className="flex items-center gap-1.5">
              <Led health="ok" small /> {drives.ok} healthy
            </span>
            {drives.warn > 0 && (
              <span className="flex items-center gap-1.5">
                <Led health="warn" small /> {drives.warn} warning
              </span>
            )}
            {drives.error > 0 && (
              <span className="flex items-center gap-1.5">
                <Led health="error" small /> {drives.error} failing
              </span>
            )}
            {drives.asleep > 0 && (
              <span className="flex items-center gap-1.5">
                <Led health="unknown" small asleep /> {drives.asleep} asleep
              </span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-fg-muted">
            {formatBytes(disks.reduce((sum, { d }) => sum + d.size, 0))} raw across all drives
          </div>
        </div>
      </div>
    </div>
  )
}
