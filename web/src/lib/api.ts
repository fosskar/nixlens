import { useEffect, useState } from 'react'

export type Me = {
  user: string
  name: string
  email: string
  groups: string[]
  admin: boolean
  accountUrl?: string
}

export type Machine = {
  name: string
  self: boolean
  online: boolean
  error: string
}

export type NetInterface = {
  name: string
  kind: 'ethernet' | 'wifi' | 'usb' | 'bond' | 'bridge' | 'vlan' | 'wireguard' | 'tun' | 'tap' | 'virtual' | string
  up: boolean
  state: string
  speedMbps?: number
  maxSpeedMbps?: number
  mac?: string
  mtu: number
  driver?: string
  master?: string
  addresses: string[]
}

export type System = {
  hostname: string
  nixosVersion: string
  kernel: string
  uptimeSec: number
  load: [number, number, number]
  cpus: number
  cores: number
  cpuPercent: number
  memTotal: number
  memAvailable: number
  memInstalled: number
  swaps: Swap[]
}

type Swap = {
  device: string
  kind: 'zram' | 'partition' | 'file' | string
  size: number
  used: number
}

export type Disk = {
  name: string
  id: string
  size: number
  model: string
  serial: string
  transport: string
  rotational: boolean
  pool?: string
  group?: string
  partitions: Partition[]
  smart?: Smart
}

export type Smart = {
  passed: boolean | null
  temperature: number
  powerOnHours: number
  reallocated: number
  pending: number
  uncorrectable: number
  criticalWarning: number
  percentageUsed: number
  mediaErrors: number
  standby: boolean
  updated: number
}

export type Partition = {
  name: string
  size: number
  fstype: string
  label: string
  mount: string
  pool: string
  role: string
}

export type PoolMember = {
  device: string
  path: string
  state: string
  errors: number
}

export type PoolGroup = {
  name: string
  layout: string
  class: string
  state: string
  members: PoolMember[]
}

type PoolScan = {
  function: string
  state: string
  end: number
  errors: number
}

export type Pool = {
  name: string
  kind: string
  state: string
  raw: number
  usable: number
  used: number
  available: number
  mount?: string
  scan?: PoolScan
  groups: PoolGroup[]
}

export type Storage = {
  pools: Pool[]
  disks: Disk[]
}

type PoolProperties = {
  ashift: string
  autotrim: string
  fragmentation: string
  dedupratio: string
  compression: string
  encryption: string
  recordsize: string
  atime: string
}

export type Dataset = {
  name: string
  type: 'filesystem' | 'volume' | string
  used: number
  available: number
  quota: number
  reservation: number
  compressRatio: string
  mountpoint: string
  snapshots: number
  snapshotsUsed: number
  lastSnapshot: number
}

export type PoolDetail = {
  properties: PoolProperties
  datasets: Dataset[]
}

export type App = {
  name: string
  url: string
  machine: string
  frameable: boolean
  icon: string
  category: string
  description: string
}

export type Poll<T> = { data?: T; error?: string }

type PollState<T> = Poll<T> & { path: string | null }

export function usePoll<T>(path: string | null, intervalMs: number): Poll<T> {
  const [state, setState] = useState<PollState<T>>({ path })
  // one request at a time: the next starts intervalMs after the previous
  // finished, so a slow peer cannot stack requests or let an old answer
  // overwrite a newer one
  useEffect(() => {
    if (path === null) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const res = await fetch(path, { signal: abort.signal })
        if (!res.ok) {
          const body = (await res.text()).trim()
          throw new Error(body || `${res.status} ${res.statusText}`)
        }
        const data = (await res.json()) as T
        setState({ path, data })
      } catch (e) {
        if (abort.signal.aborted) return
        const error = e instanceof Error ? e.message : String(e)
        setState((s) => ({ path, data: s.path === path ? s.data : undefined, error }))
      }
      if (!abort.signal.aborted) timer = setTimeout(load, intervalMs)
    }
    load()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [path, intervalMs])
  return state.path === path ? state : {}
}

// drives use decimal units as vendors label them, memory uses binary units
export function formatBytes(bytes: number, binary = false): string {
  const base = binary ? 1024 : 1000
  const units = binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (bytes >= base && i < units.length - 1) {
    bytes /= base
    i++
  }
  return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
