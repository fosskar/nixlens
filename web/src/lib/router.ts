import { useSyncExternalStore } from 'react'

// every view has an address, so the browser's back and forward, the phone's
// back gesture, reloads and bookmarks all work. popups and app windows are
// "layers" opened from the home view; breadcrumbs show where a view sits,
// back walks the history
export type Route =
  | { kind: 'home' }
  | { kind: 'machine'; machine: string }
  | { kind: 'pool' | 'disk'; machine: string; name: string }
  | { kind: 'app'; machine: string; name: string }

// idx counts entries within this tab; base is the entry the current layer
// was opened from, or null when it was reached directly through its address
type State = { idx: number; base: number | null }

function parse(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'm' && parts.length === 2) return { kind: 'machine', machine: parts[1] }
  if (parts[0] === 'm' && parts.length === 4 && (parts[2] === 'pool' || parts[2] === 'disk'))
    return { kind: parts[2], machine: parts[1], name: parts[3] }
  if (parts[0] === 'app' && parts.length === 3) return { kind: 'app', machine: parts[1], name: parts[2] }
  return { kind: 'home' }
}

function pathOf(route: Route): string {
  const e = encodeURIComponent
  switch (route.kind) {
    case 'home':
      return '/'
    case 'machine':
      return `/m/${e(route.machine)}`
    case 'pool':
    case 'disk':
      return `/m/${e(route.machine)}/${route.kind}/${e(route.name)}`
    case 'app':
      return `/app/${e(route.machine)}/${e(route.name)}`
  }
}

function isState(value: unknown): value is State {
  return typeof value === 'object' && value !== null && typeof (value as State).idx === 'number'
}

if (!isState(history.state)) history.replaceState({ idx: 0, base: null } satisfies State, '')

let current = parse(location.pathname)
const listeners = new Set<() => void>()

function emit() {
  current = parse(location.pathname)
  listeners.forEach((l) => l())
}
window.addEventListener('popstate', emit)

function state(): State {
  return history.state as State
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

export function navigate(to: Route) {
  if (pathOf(to) === location.pathname) return
  const s = state()
  const base = to.kind === 'home' ? null : (s.base ?? (current.kind === 'home' ? s.idx : null))
  history.pushState({ idx: s.idx + 1, base } satisfies State, '', pathOf(to))
  emit()
}

// leaves the current layer for the view it was opened from, so the back
// gesture afterwards does not reopen what was just closed
export function closeLayer() {
  const s = state()
  if (s.base !== null) {
    history.go(s.base - s.idx)
    return
  }
  history.replaceState({ idx: s.idx, base: null } satisfies State, '', '/')
  emit()
}

// whether back stays inside the current layer
export function canGoBack(): boolean {
  const s = state()
  return s.base !== null && s.idx - 1 > s.base
}

export function goBack() {
  history.back()
}
