import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

type Store = typeof import('./store.ts')

let fetches = 0
let answer: () => { ok: boolean; body: unknown }
const page = Object.assign(new EventTarget(), { hidden: false })

beforeEach(() => {
  fetches = 0
  answer = () => ({ ok: true, body: { message: 'maintenance', updated: 1 } })
  page.hidden = false
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 })
  Object.assign(globalThis, {
    document: page,
    fetch: async () => {
      fetches++
      const { ok, body } = answer()
      return { ok, status: ok ? 200 : 502, statusText: '', json: async () => body, text: async () => 'down' }
    },
  })
  mock.method(console, 'warn', () => {})
})

afterEach(() => {
  mock.timers.reset()
  mock.restoreAll()
})

// a fresh module per test, so no poller or notice carries over
let imports = 0
const load = () => import(`./store.ts?${imports++}`) as Promise<Store>

// runs due timers and lets a pending fetch and its json() settle
const settle = async () => {
  mock.timers.tick(0)
  await new Promise((resolve) => setImmediate(resolve))
}

const tick = async (ms: number) => {
  mock.timers.tick(ms)
  await settle()
}

test('resubscribing, as react does after each render, fetches once', async () => {
  const store = await load()
  let unsubscribe = store.subscribe(() => {})
  await settle()
  for (let i = 0; i < 100; i++) {
    unsubscribe()
    unsubscribe = store.subscribe(() => {})
    await settle()
  }
  assert.equal(fetches, 1)
})

test('an unchanged notice does not notify subscribers', async () => {
  const store = await load()
  let notified = 0
  store.subscribe(() => notified++)
  await settle()
  const first = store.getSnapshot()
  await tick(60_000)
  assert.equal(fetches, 2)
  assert.equal(notified, 1)
  assert.equal(store.getSnapshot(), first)
})

test('polls every minute and backs off on errors', async () => {
  const store = await load()
  store.subscribe(() => {})
  await settle()
  await tick(60_000)
  assert.equal(fetches, 2)

  answer = () => ({ ok: false, body: null })
  await tick(60_000)
  assert.equal(fetches, 3)
  await tick(60_000)
  assert.equal(fetches, 3, 'one failure waits two minutes')
  await tick(60_000)
  assert.equal(fetches, 4)
  await tick(3 * 60_000)
  assert.equal(fetches, 4, 'two failures wait four minutes')
  await tick(60_000)
  assert.equal(fetches, 5)

  answer = () => ({ ok: true, body: { message: '' } })
  await tick(8 * 60_000)
  assert.equal(fetches, 6)
  await tick(60_000)
  assert.equal(fetches, 7, 'a success resets the interval')
})

test('stops polling when the last subscriber leaves', async () => {
  const store = await load()
  const unsubscribe = store.subscribe(() => {})
  await settle()
  unsubscribe()
  await tick(10 * 60_000)
  assert.equal(fetches, 1)
})

test('pauses while the tab is hidden', async () => {
  const store = await load()
  store.subscribe(() => {})
  await settle()
  page.hidden = true
  await tick(10 * 60_000)
  assert.equal(fetches, 1)
  page.hidden = false
  page.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(fetches, 2)
})
