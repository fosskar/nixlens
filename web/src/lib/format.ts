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

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(unix: number): string {
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

export function shortAgo(unix: number): string {
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

export function formatUsage(used: number, total: number): string {
  const [usedValue, usedUnit] = formatCapacity(used).split(' ')
  const [totalValue, totalUnit] = formatCapacity(total).split(' ')
  return usedUnit === totalUnit
    ? `${usedValue} / ${totalValue} ${totalUnit}`
    : `${usedValue} ${usedUnit} / ${totalValue} ${totalUnit}`
}

export function formatRecordsize(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return value
  return n >= 1048576 ? `${n / 1048576}M` : `${n / 1024}K`
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`
}
