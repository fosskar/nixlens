import { useId } from 'react'
import { card, Led, Loading, Ring, SectionTitle, StaleNote, Unavailable } from '@/components/ui'
import { PoolBays } from '@/features/overview/pool-bays'
import { type MachineOverview } from '@/features/overview/machines'
import { type Disk, type Poll } from '@/lib/api'
import { driveHealth, type Health, healthLabels, poolHealth } from '@/lib/health'
import { setPrefs, usePrefs } from '@/lib/prefs'
import { closeLayer, navigate, useRoute } from '@/lib/router'
import { type Target, usedPercent } from '@/lib/storage'

type Problem = { health: Health; text: string; target?: Target }

const fullAt = 90
const gib = 1024 ** 3

function driveProblem(disk: Disk): string {
  const s = disk.smart
  if (s?.passed === false) return 'SMART failed'
  const parts = [
    s?.reallocated && `${s.reallocated} reallocated sectors`,
    s?.pending && `${s.pending} pending sectors`,
    s?.uncorrectable && `${s.uncorrectable} uncorrectable`,
    s?.criticalWarning && 'critical warning',
    s?.mediaErrors && `${s.mediaErrors} media errors`,
    s && s.percentageUsed >= 90 && `${s.percentageUsed}\u00a0% worn`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'errors in its pool'
}

// what needs a look on one machine, worst first
function problems(m: MachineOverview): Problem[] {
  const pools = m.storage?.pools ?? []
  const items: Problem[] = []
  for (const pool of pools) {
    const health = poolHealth(pool)
    if (health === 'warn' || health === 'error') {
      items.push({
        health,
        text: `${pool.name} is ${pool.state.toLowerCase()}`,
        target: { kind: 'pool', name: pool.name },
      })
    } else if (pool.state !== 'unmounted' && usedPercent(pool) >= fullAt) {
      items.push({
        health: 'warn',
        text: `${pool.name} is ${Math.round(usedPercent(pool))}\u00a0% full`,
        target: { kind: 'pool', name: pool.name },
      })
    }
  }
  for (const disk of m.storage?.disks ?? []) {
    const health = driveHealth(disk, pools)
    if (health === 'warn' || health === 'error') {
      items.push({
        health,
        text: `${disk.serial || disk.name}: ${driveProblem(disk)}`,
        target: { kind: 'disk', name: disk.name },
      })
    }
  }
  return items.sort((a, b) => (a.health === b.health ? 0 : a.health === 'error' ? -1 : 1))
}

// the last part of a go error is the cause ("connection refused"); the full
// text follows below it
function shortError(error?: string): string {
  if (!error) return 'unreachable'
  return error.split(': ').at(-1) ?? error
}

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  return d > 0 ? `${d}d` : `${Math.floor(sec / 3600)}h`
}

function MachineCard({ m }: { m: MachineOverview }) {
  const s = m.system
  const items = problems(m)
  const health = m.loading
    ? 'unknown'
    : m.online
      ? items.some((i) => i.health === 'error')
        ? 'error'
        : items.length
          ? 'warn'
          : 'ok'
      : 'error'
  const route = useRoute()
  const open = route.kind !== 'home' && route.machine === m.name

  // the whole card opens the machine, or closes it when open; problem lines open their pool or drive
  // and sit above the card's button, since buttons cannot nest
  return (
    <div className={`${card} relative p-3.5`}>
      <button
        type="button"
        onClick={() => (open ? closeLayer() : navigate({ kind: 'machine', machine: m.name }))}
        aria-label={`${open ? 'Close' : 'Open'} ${m.name}`}
        aria-expanded={open}
        className="absolute inset-0 rounded-card outline-accent-cyan transition hover:bg-fill focus-visible:outline-2"
      />
      <div className="pointer-events-none relative flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Led health={health} label={healthLabels[health]} />
            <h3 translate="no" className="truncate text-sm font-semibold text-fg-inverse">
              {m.name}
            </h3>
            {m.self && <span className="text-2xs text-accent-fg">hub</span>}
            <span className="ml-auto shrink-0 font-mono text-xs text-fg-muted">
              {s ? `up ${uptime(s.uptimeSec)}` : m.loading ? '' : 'offline'}
            </span>
          </div>
          {s && (
            <div className="mt-1 truncate pl-4 font-mono text-xs text-fg-muted">
              NixOS {s.nixosVersion.split('.').slice(0, 2).join('.')} · Linux {s.kernel} · {s.cores}c/{s.cpus}t
            </div>
          )}
          {!m.online && !m.loading && (
            <div className="mt-1 pl-4 text-xs">
              <div className="text-error">{shortError(m.error)}</div>
              {m.error && (
                <div className="mt-0.5 font-mono break-words whitespace-pre-line text-fg-muted">{m.error}</div>
              )}
            </div>
          )}
        </div>

        {m.loading && <Loading className="ml-4 h-3 w-24 rounded-full" />}

        {s && (
          <div className="grid grid-cols-2 gap-3">
            <Ring small label="CPU" value={s.cpuPercent} detail={`load ${s.load[0].toFixed(2)}`} />
            <Ring
              small
              label="Memory"
              value={(100 * (s.memTotal - s.memAvailable)) / s.memTotal}
              detail={`${Math.round((s.memTotal - s.memAvailable) / gib)} / ${Math.round((s.memInstalled || s.memTotal) / gib)}\u00a0GiB`}
            />
          </div>
        )}

        {m.storage && (
          <div className="pointer-events-auto">
            <PoolBays storage={m.storage} onOpen={(t) => navigate({ kind: t.kind, machine: m.name, name: t.name })} />
          </div>
        )}

        {items.length > 0 && (
          <div className="pointer-events-auto -mx-1.5 flex flex-col">
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  item.target && navigate({ kind: item.target.kind, machine: m.name, name: item.target.name })
                }
                className="flex items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs text-fg-base outline-accent-cyan transition hover:bg-fill-hover focus-visible:outline-2"
              >
                <Led health={item.health} small />
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
                <span aria-hidden="true" className="text-fg-muted">
                  ›
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function OverviewWidget({ poll }: { poll: Poll<MachineOverview[]> }) {
  const { machinesOpen: open } = usePrefs()
  const listId = useId()
  const machines = poll.data
  if (!machines) return <Unavailable error={poll.error} className="h-48" />

  const offline = machines.filter((m) => !m.online && !m.loading).length
  const attention = machines.filter((m) => m.online && problems(m).length > 0).length
  const summary =
    offline + attention === 0
      ? machines.some((m) => m.loading)
        ? 'checking…'
        : 'all healthy'
      : [offline && `${offline} offline`, attention && `${attention} need${attention === 1 ? 's' : ''} attention`]
          .filter(Boolean)
          .join(' · ')

  const count = `${machines.length} ${machines.length === 1 ? 'machine' : 'machines'}`
  // on phones the sidebar sits above the apps, so its cards stay folded into
  // the summary until opened
  return (
    <div>
      <h2 className="md:hidden">
        <button
          type="button"
          onClick={() => setPrefs({ machinesOpen: !open })}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full items-baseline justify-between gap-3 rounded-control px-1 text-fg-muted outline-accent-cyan transition-colors hover:text-fg-base focus-visible:outline-2"
        >
          <span className="flex items-center gap-2 text-2xs font-semibold tracking-[0.12em] uppercase">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`h-3 w-3 shrink-0 self-center fill-none stroke-current transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            {count}
          </span>
          <span className="font-mono text-xs tabular-nums">{summary}</span>
        </button>
      </h2>
      <div className="hidden md:block">
        <SectionTitle level={2} aside={summary}>
          {count}
        </SectionTitle>
      </div>
      <StaleNote poll={poll} />
      <div id={listId} className={`flex-col gap-2.5 md:mt-0 md:flex ${open ? 'mt-3 flex' : 'hidden'}`}>
        {machines.map((m) => (
          <MachineCard key={m.name} m={m} />
        ))}
      </div>
    </div>
  )
}
