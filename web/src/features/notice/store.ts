export type Notice = {
  message: string
  updated?: number
}

const intervalMs = 60_000
const maxBackoffMs = 15 * 60_000
const requestTimeout = 15_000

// one poller for the banner and the editor, which updates it on saving.
// react unsubscribes and resubscribes whenever subscribe changes, so the
// poller never fetches sooner than its interval after the previous request,
// however often subscribers come and go
let current: Notice = { message: '' }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let loading = false
let lastStart = -Infinity
let failures = 0

function publish(n: Notice) {
  // a new object for the same notice would render every subscriber again
  if (n.message === current.message && n.updated === current.updated) return
  current = n
  listeners.forEach((l) => l())
}

async function fetchNotice(init?: RequestInit): Promise<Notice> {
  const res = await fetch('/api/notice', { ...init, signal: AbortSignal.timeout(requestTimeout) })
  if (!res.ok) throw new Error((await res.text()).trim() || `${res.status} ${res.statusText}`)
  return (await res.json()) as Notice
}

function schedule() {
  clearTimeout(timer)
  timer = undefined
  if (listeners.size === 0 || loading) return
  const delay = Math.min(intervalMs * 2 ** failures, maxBackoffMs)
  timer = setTimeout(poll, Math.max(0, lastStart + delay - Date.now()))
}

// a hidden tab stops polling and catches up once it is visible again
function onVisible() {
  if (document.hidden) return
  document.removeEventListener('visibilitychange', onVisible)
  schedule()
}

async function poll() {
  timer = undefined
  if (document.hidden) {
    document.addEventListener('visibilitychange', onVisible)
    return
  }
  loading = true
  lastStart = Date.now()
  try {
    publish(await fetchNotice())
    failures = 0
  } catch (e) {
    failures++
    console.warn('notice:', e)
  }
  loading = false
  schedule()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) schedule()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) schedule()
  }
}

export function getSnapshot(): Notice {
  return current
}

export async function save(message: string) {
  publish(
    await fetchNotice({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  )
}
