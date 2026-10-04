// health and capacity rules shared by the storage views and the overview
import type { Disk, Pool, PoolMember, Smart } from './api'

export type Health = 'ok' | 'warn' | 'error' | 'unknown'

const healthRank: Record<Health, number> = { ok: 0, unknown: 1, warn: 2, error: 3 }

const errorStates = ['faulted', 'offline', 'unavail', 'removed', 'faulty']

const okPoolStates = ['online', 'clean', 'active', 'active-idle', 'read-auto', 'write-pending', 'mounted']

function stateTokens(state: string): string[] {
  return state
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t !== '')
}

export function resilvering(pool: Pool): boolean {
  return pool.scan?.function === 'RESILVER' && pool.scan.state === 'SCANNING'
}

export function stateHealth(state: string): Health {
  const tokens = stateTokens(state)
  if (tokens.includes('unmounted')) return 'unknown'
  if (tokens.includes('degraded') || tokens.includes('recovering') || tokens.includes('resyncing')) return 'warn'
  if (tokens.length > 0 && tokens.every((t) => okPoolStates.includes(t))) return 'ok'
  return 'error'
}

export function poolHealth(pool: Pool): Health {
  const health = stateHealth(pool.state)
  return health === 'ok' && resilvering(pool) ? 'warn' : health
}

export function memberHealth(member: PoolMember, pool: Pool): Health {
  const tokens = stateTokens(member.state)
  if (member.device === '' || tokens.some((t) => errorStates.includes(t))) return 'error'
  if (tokens.includes('degraded') || resilvering(pool) || member.errors > 0) return 'warn'
  if (tokens.includes('online') || tokens.includes('in_sync')) return 'ok'
  return 'unknown'
}

export function worst(healths: Health[]): Health {
  return healths.reduce<Health>((a, b) => (healthRank[b] > healthRank[a] ? b : a), 'ok')
}

// one decimal below 100 so pool capacities like "11.5 TB" keep their precision
export function formatCapacity(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (bytes >= 1000 && i < units.length - 1) {
    bytes /= 1000
    i++
  }
  return `${bytes.toFixed(bytes < 100 && i > 0 ? 1 : 0)} ${units[i]}`
}

export function redundant(pool: Pool): boolean {
  return pool.kind === 'zfs' || pool.kind === 'md'
}

// failed overall assessment is red; sector problems, nvme warnings and
// heavy wear are early signs and orange
export function smartHealth(smart?: Smart): Health | null {
  if (!smart || smart.passed === null) return null
  if (!smart.passed) return 'error'
  if (
    smart.reallocated > 0 ||
    smart.pending > 0 ||
    smart.uncorrectable > 0 ||
    smart.criticalWarning > 0 ||
    smart.mediaErrors > 0 ||
    smart.percentageUsed >= 90
  )
    return 'warn'
  return 'ok'
}

export function driveHealth(disk: Disk, pools: Pool[]): Health {
  const members = pools
    .filter(redundant)
    .flatMap((p) =>
      p.groups.flatMap((g) => g.members.filter((m) => m.device === disk.name).map((m) => memberHealth(m, p))),
    )
  const smart = smartHealth(disk.smart)
  return worst(smart ? [...members, smart] : members)
}
