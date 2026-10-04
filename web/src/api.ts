import { useEffect, useState } from 'react'

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
}

export function usePoll<T>(path: string, intervalMs: number): T | undefined {
  const [data, setData] = useState<T>()
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const res = await fetch(path)
      if (!res.ok) throw new Error(`${path}: ${res.status}`)
      const json = (await res.json()) as T
      if (!cancelled) setData(json)
    }
    load()
    const timer = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [path, intervalMs])
  return data
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (bytes >= 1000 && i < units.length - 1) {
    bytes /= 1000
    i++
  }
  return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
