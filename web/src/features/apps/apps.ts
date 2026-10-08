import { type App, type AppIndex, usePoll, usePolls } from '@/lib/api'

const interval = 300000

function appsPath(machine: string): string {
  return `/api/apps/${encodeURIComponent(machine)}`
}

// byte order, as the hub sorts
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// each machine's apps arrive on their own, so one that cannot be reached
// leaves out only its apps
export function useApps(): { apps: App[]; error?: string; settled: (machine: string) => boolean } {
  const index = usePoll<AppIndex>('/api/apps', interval)
  const machines = index.data?.machines ?? []
  const lists = usePolls<App[]>(
    machines.map((m) => appsPath(m.name)),
    interval,
  )

  const categories = index.data?.categories ?? []
  // listed categories first in their order, then the rest, uncategorized last
  const rank = (category: string) => {
    const i = categories.indexOf(category)
    return i >= 0 ? i : category === '' ? categories.length + 1 : categories.length
  }
  const self = machines.find((m) => m.self)?.name
  const all = machines
    .flatMap((m) => lists[appsPath(m.name)]?.data ?? [])
    .sort(
      (a, b) =>
        rank(a.category) - rank(b.category) ||
        compare(a.category, b.category) ||
        compare(a.name, b.name) ||
        Number(b.machine === self) - Number(a.machine === self) ||
        compare(a.machine, b.machine),
    )
  // self sorts first among equal urls, so the hub's own entry stays
  const seen = new Set<string>()
  const apps = all.filter((a) => !seen.has(a.url) && seen.add(a.url))

  return {
    apps,
    // a machine that cannot be reached shows in the overview; only the hub's
    // own list failing is an error here
    error: index.error ?? (self !== undefined ? lists[appsPath(self)]?.error : undefined),
    settled: (machine) =>
      index.data !== undefined && (!machines.some((m) => m.name === machine) || appsPath(machine) in lists),
  }
}
