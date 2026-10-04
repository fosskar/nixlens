import { useSyncExternalStore } from 'react'

// per-browser preferences; configuration lives in nix, these only change how
// this browser shows it
export const accents = {
  teal: ['#16a085', '#1abc9c'],
  blue: ['#3b6fd4', '#6796e6'],
  amber: ['#b7862a', '#c79a3a'],
  violet: ['#8e5bb5', '#c586c0'],
} as const

export type Accent = keyof typeof accents

export type Prefs = {
  accent: Accent
  glow: number
  solid: boolean
  reduceMotion: boolean
  floating: boolean
  collapsed: string[]
}

const key = 'nos.prefs'
const defaults: Prefs = { accent: 'teal', glow: 1, solid: false, reduceMotion: false, floating: false, collapsed: [] }

// a value from another version or edited by hand must not break the page
function load(): Prefs {
  const stored = localStorage.getItem(key)
  if (!stored) return defaults
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch (e) {
    if (e instanceof SyntaxError) return defaults
    throw e
  }
  if (typeof parsed !== 'object' || parsed === null) return defaults
  const p = parsed as Record<string, unknown>
  return {
    accent: typeof p.accent === 'string' && p.accent in accents ? (p.accent as Accent) : defaults.accent,
    glow: typeof p.glow === 'number' && p.glow >= 0 && p.glow <= 1 ? p.glow : defaults.glow,
    solid: p.solid === true,
    reduceMotion: p.reduceMotion === true,
    floating: p.floating === true,
    collapsed: Array.isArray(p.collapsed) ? p.collapsed.filter((c): c is string => typeof c === 'string') : [],
  }
}

let current = load()
const listeners = new Set<() => void>()

function apply(prefs: Prefs) {
  const root = document.documentElement
  const [accent, cyan] = accents[prefs.accent]
  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-accent-cyan', cyan)
  root.style.setProperty('--nos-glow', String(prefs.glow))
  root.classList.toggle('nos-solid', prefs.solid)
  root.classList.toggle('nos-reduce-motion', prefs.reduceMotion)
}
apply(current)

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch }
  localStorage.setItem(key, JSON.stringify(current))
  apply(current)
  listeners.forEach((l) => l())
}

export function resetPrefs() {
  localStorage.removeItem(key)
  current = defaults
  apply(current)
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

export function reducedMotion(): boolean {
  return current.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
