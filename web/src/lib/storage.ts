import {
  type Dataset,
  type Disk,
  formatBytes,
  type Partition,
  type Pool,
  type PoolGroup,
  type PoolMember,
  type Storage,
} from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { type Health, memberHealth, redundant, worst } from '@/lib/health'

type Bay = { pool: Pool; groups: { label: string; drives: Disk[] }[] }

// drives grouped by the pool that keeps its data on them, and within it by
// vdev. a log, cache or spare on a drive does not make it part of a pool,
// and boot partitions are left out, so drives with only those are not
// shown, nor are unused drives
export function poolBays(storage: Storage): Bay[] {
  const disks = storage.disks ?? []
  const placed = new Set<string>()
  const take = (keep: (d: Disk) => boolean) => {
    const drives = disks.filter((d) => keep(d) && !placed.has(d.name))
    drives.forEach((d) => placed.add(d.name))
    return drives
  }
  return (storage.pools ?? [])
    .filter((pool) => pool.kind !== 'vfat')
    .map((pool) => {
      const data = pool.groups.filter((g) => g.class === '' || g.class === 'data')
      const groups = data.map((g) => {
        const members = g.members.map((m) => m.device)
        const drives = take((d) => members.includes(d.name)).sort(
          (a, b) => members.indexOf(a.name) - members.indexOf(b.name),
        )
        return { label: g.layout && g.layout !== 'single' ? g.layout : g.name, drives }
      })
      return { pool, groups: groups.filter((g) => g.drives.length > 0) }
    })
}

export function scanLine(pool: Pool): { text: string; health: Health } | null {
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

export function usedPercent(pool: Pool): number {
  return pool.usable > 0 ? (100 * pool.used) / pool.usable : 0
}

export function poolType(pool: Pool): string {
  if (!redundant(pool)) return pool.kind
  const layouts = new Set(
    pool.groups
      .filter((g) => g.class === 'data' || g.class === '')
      .map((g) => g.layout)
      .filter((l) => l !== '' && l !== 'single'),
  )
  return layouts.size > 0 ? `${pool.kind} · ${[...layouts].join(' + ')}` : pool.kind
}

function trailingNumber(name: string): string | undefined {
  return /(\d+)$/.exec(name)?.[1]
}

export function memberPartition(member: PoolMember, pool: Pool, disk?: Disk): string {
  const base = member.path.split('/').pop() || member.device
  const candidates = (disk?.partitions ?? []).filter((p) => p.pool === pool.name)
  if (candidates.length === 1) return candidates[0].name
  const number = /-part(\d+)$/.exec(member.path)?.[1]
  return candidates.find((p) => number && trailingNumber(p.name) === number)?.name ?? base
}

export function driveTitle(disk: Disk): string {
  return [
    disk.model,
    `/dev/${disk.name}`,
    formatBytes(disk.size),
    ...(disk.partitions ?? []).filter((p) => p.pool).map((p) => `${p.name} → ${p.pool}${p.role ? ` · ${p.role}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n')
}

export type Target = { kind: 'pool' | 'disk'; name: string }

// raw space of the drives a pool keeps its data on; zfs reports parity
// for raidz but not the second half of a mirror, so it is summed here
export function rawCapacity(pool: Pool, disks: Disk[]): number {
  return pool.groups
    .filter((g) => g.class === '' || g.class === 'data')
    .flatMap((g) => g.members)
    .reduce((sum, member) => {
      const disk = disks.find((d) => d.name === member.device)
      const name = memberPartition(member, pool, disk)
      const partition = disk?.partitions?.find((p) => p.name === name)
      return sum + (partition?.size ?? disk?.size ?? 0)
    }, 0)
}

export function groupTitle(group: PoolGroup): string {
  return `${group.name} · ${group.class || 'data'}`
}

// how many member failures a vdev survives by its layout
export function tolerance(group: PoolGroup): number | null {
  if (group.class === 'cache' || group.class === 'spare') return null
  if (group.layout === 'mirror') return group.members.length - 1
  const raidz = /^raidz(\d)?$/.exec(group.layout)
  if (raidz) return Number(raidz[1] ?? 1)
  return 0
}

export function datasetDepth(dataset: Dataset, pool: string): number {
  return dataset.name === pool ? 0 : dataset.name.split('/').length - 1
}

export function partitionHealth(partition: Partition, disk: Disk, pools: Pool[]): Health | undefined {
  const pool = pools.find((p) => p.name === partition.pool && redundant(p))
  const members = pool?.groups.flatMap((g) => g.members).filter((m) => m.device === disk.name) ?? []
  return pool && members.length > 0 ? worst(members.map((m) => memberHealth(m, pool))) : undefined
}

// what shops list a drive as: without the vendor prefix the kernel shows
// for wd drives ("WDC "), and without the oem suffix wd and seagate add
// to a model number ("WD60EFPX-68C5ZN0", "ST8000VN004-2M2101")
export function shopQuery(model: string): string {
  return model.replace(/^(WDC|ATA)\s+/i, '').replace(/^(\w+)-\w+$/, '$1')
}

export function poolLayout(pool: Pool): string {
  const layouts = [
    ...new Set(
      pool.groups
        .filter((g) => g.class === '' || g.class === 'data')
        .map((g) => g.layout)
        .filter((l) => l !== '' && l !== 'single'),
    ),
  ]
  return layouts.length > 0 ? layouts.join(' + ') : pool.kind
}

export type DriveKind = 'hdd' | 'ssd' | 'nvme'

export function driveKind(disk: Disk): DriveKind {
  if (disk.transport === 'nvme') return 'nvme'
  return disk.rotational ? 'hdd' : 'ssd'
}
