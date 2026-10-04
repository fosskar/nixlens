import { useEffect, useState } from 'react'

export type Machine = {
  name: string
  self: boolean
  online: boolean
  error: string
}

export type System = {
  hostname: string
  nixosVersion: string
  kernel: string
  uptimeSec: number
  load: [number, number, number]
  cpus: number
  cpuPercent: number
  memTotal: number
  memAvailable: number
  swapTotal: number
  swapFree: number
}

export type Disk = {
  name: string
  id: string
  size: number
  model: string
  serial: string
  transport: string
  rotational: boolean
}

export type App = {
  name: string
  url: string
  machine: string
  frameable: boolean
}

export type Poll<T> = { data?: T; error?: string }

type PollState<T> = Poll<T> & { path: string | null }

export function usePoll<T>(path: string | null, intervalMs: number): Poll<T> {
  const [state, setState] = useState<PollState<T>>({ path })
  useEffect(() => {
    if (path === null) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(path)
        if (!res.ok) {
          const body = (await res.text()).trim()
          throw new Error(body || `${res.status} ${res.statusText}`)
        }
        const data = (await res.json()) as T
        if (!cancelled) setState({ path, data })
      } catch (e) {
        if (cancelled) return
        const error = e instanceof Error ? e.message : String(e)
        setState((s) => ({ path, data: s.path === path ? s.data : undefined, error }))
      }
    }
    load()
    const timer = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
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
