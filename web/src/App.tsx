import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '@/components/scroll'
import { glass } from '@/components/ui'
import { Dock } from '@/features/apps/dock'
import { AppGrid } from '@/features/apps/grid'
import { AppWindow, type Point } from '@/features/apps/window'
import { Inspector } from '@/features/inspector/inspector'
import { NoticeBanner } from '@/features/notice/notice'
import { useOverview } from '@/features/overview/machines'
import { OverviewWidget } from '@/features/overview/overview'
import { UserMenu } from '@/features/user/user'
import { useApps } from '@/features/apps/apps'
import { type App as AppEntry, type Me, usePoll } from '@/lib/api'
import { reducedMotion, setPrefs, usePrefs } from '@/lib/prefs'
import { closeLayer, navigate, useRoute } from '@/lib/router'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'good night'
  if (h < 12) return 'good morning'
  if (h < 18) return 'good afternoon'
  return 'good evening'
}

// viewport centre of an icon; the window turns it into its own transform
// origin, since its position depends on the floating preference
function originOf(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function dockRect(url: string): DOMRect | undefined {
  return document.querySelector(`[data-dock="${CSS.escape(url)}"]`)?.getBoundingClientRect()
}

export default function App() {
  const mePoll = usePoll<Me>('/api/me', 60000)
  const me = mePoll.data
  const settled = me !== undefined || mePoll.error !== undefined
  const admin = me?.admin ?? false
  const firstName = me?.name.split(' ')[0].toLowerCase()
  const overview = useOverview(admin)
  const machines = overview.data ?? []
  const { apps, error: appsError, settled: appsSettled } = useApps()

  // the address decides what is in front: an app window, a detail panel or
  // nothing over the home view
  const route = useRoute()
  const detail = route.kind === 'machine' || route.kind === 'pool' || route.kind === 'disk' ? route : null
  const routeApp =
    route.kind === 'app'
      ? apps.find((a) => a.machine === route.machine && a.name === route.name && a.frameable)
      : undefined
  const routeAppSettled = route.kind === 'app' && appsSettled(route.machine)
  const active = routeApp?.url ?? null

  const [open, setOpen] = useState<AppEntry[]>([])
  // an app in the address joins the open windows, also after a reload or
  // when the back gesture returns to it; adjusted while rendering, as react
  // recommends for state that follows other values
  if (routeApp && !open.some((a) => a.url === routeApp.url)) setOpen([...open, routeApp])
  const [origins, setOrigins] = useState<Record<string, Point>>({})
  const [closing, setClosing] = useState<string[]>([])
  // a closed detail panel stays until it has drawn back under the sidebar
  const [shownDetail, setShownDetail] = useState(detail)
  if (detail && detail !== shownDetail) setShownDetail(detail)
  const detailLeaving = detail === null && shownDetail !== null
  useEffect(() => {
    if (!detailLeaving) return
    const timer = setTimeout(() => setShownDetail(null), reducedMotion() ? 0 : 150)
    return () => clearTimeout(timer)
  }, [detailLeaving])
  const closingRef = useRef(new Set<string>())
  // where keyboard focus was before an app came to the front, to return there
  const returnFocus = useRef<HTMLElement | null>(null)
  const { floating } = usePrefs()
  const toggleFloating = () => setPrefs({ floating: !floating })

  const setOrigin = (url: string, rect?: DOMRect) => {
    if (rect) setOrigins((o) => ({ ...o, [url]: originOf(rect) }))
  }

  const openApp = (app: AppEntry, from?: DOMRect) => {
    if (!app.frameable) {
      window.open(app.url, '_blank', 'noopener')
      return
    }
    setOrigin(app.url, from)
    closingRef.current.delete(app.url)
    setClosing((c) => c.filter((u) => u !== app.url))
    if (active === null && document.activeElement instanceof HTMLElement) returnFocus.current = document.activeElement
    navigate({ kind: 'app', machine: app.machine, name: app.name })
  }

  // addresses that cannot be shown lead home: an app that does not exist
  // (or cannot be framed), or details for someone who may not see them
  useEffect(() => {
    if (route.kind === 'app' && routeAppSettled && !routeApp) closeLayer()
    if (detail && me && !admin) closeLayer()
  }, [route, routeAppSettled, routeApp, detail, me, admin])

  useEffect(() => {
    if (active === null) returnFocus.current?.focus()
  }, [active])

  const goHome = () => {
    if (!active) return
    setOrigin(active, dockRect(active))
    closeLayer()
  }

  const closeApp = (app: AppEntry) => {
    setOrigin(app.url, dockRect(app.url))
    if (active === app.url) closeLayer()
    closingRef.current.add(app.url)
    setClosing((c) => [...c, app.url])
    setTimeout(
      () => {
        if (!closingRef.current.delete(app.url)) return
        setOpen((o) => o.filter((a) => a.url !== app.url))
        setClosing((c) => c.filter((u) => u !== app.url))
      },
      reducedMotion() ? 150 : 400,
    )
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const rect = dockRect(active)
      if (rect) setOrigins((o) => ({ ...o, [active]: originOf(rect) }))
      closeLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // names what is in front, so tabs and history tell views apart
  const title = routeApp ? `${routeApp.name} · nixlens` : admin && detail ? `${detail.machine} · nixlens` : 'nixlens'

  const online = machines.filter((m) => m.online).length

  return (
    <div className="min-h-screen text-fg-base">
      <title>{title}</title>
      {/* the layout depends on the sidebar, known once /api/me answers, so it
          is painted in its final place. on phones details cover the screen, and
          the home view goes while they are open instead of showing through */}
      {settled && (
        <div
          className={`transition-opacity duration-300 ${active ? 'pointer-events-none opacity-0' : 'opacity-100'} ${detail ? 'max-md:invisible' : ''}`}
          inert={active !== null}
        >
          <UserMenu me={me} hidden={detail !== null} />
          {admin && (
            <aside
              className={`${glass} m-3 mt-[calc(4rem+var(--safe-top))] flex flex-col md:z-[36] md:fixed md:top-[calc(0.75rem+var(--safe-top))] md:bottom-[calc(0.75rem+var(--safe-bottom))] md:left-[calc(0.75rem+var(--safe-left))] md:m-0 md:w-[22rem] md:overflow-hidden`}
            >
              <ScrollArea>
                <div className="flex flex-col gap-7 p-4 md:pb-6">
                  <div className="flex items-center gap-2.5 px-1 pt-1">
                    <img src="/favicon.svg" alt="" className="h-7 w-7" />
                    <span className="text-lg font-semibold tracking-tight text-fg-inverse">nixlens</span>
                  </div>
                  <OverviewWidget poll={overview} />
                </div>
              </ScrollArea>
            </aside>
          )}

          <main
            inert={detail !== null}
            className={`nixlens-dock-fade px-6 ${admin ? 'pt-8' : 'pt-[calc(4.5rem+var(--safe-top))]'} pb-32 transition-transform duration-300 md:fixed md:inset-y-0 md:right-0 md:overflow-y-auto ${admin ? 'md:left-[23.5rem]' : 'md:left-0'} md:pt-[calc(4rem+var(--safe-top))] ${active ? 'scale-[0.985]' : ''}`}
          >
            <div className="mx-auto max-w-5xl">
              <header className="mb-10 text-center">
                <h1 className="bg-gradient-to-b from-fg-inverse to-fg-base bg-clip-text text-4xl leading-tight font-semibold tracking-tight text-transparent md:text-5xl">
                  {greeting()}
                  {firstName && `, ${firstName}`}.
                </h1>
                {admin && (
                  // keeps its line while the overview loads, so the apps below do not move
                  <p className="mt-3 min-h-5 text-sm text-fg-muted tabular-nums">
                    {overview.data &&
                      `${online} of ${machines.length} ${machines.length === 1 ? 'machine' : 'machines'} online · ${apps.length} apps`}
                  </p>
                )}
                {appsError && (
                  <p className="mt-2 text-sm text-error/90" title={appsError}>
                    {apps.length > 0 ? 'The app list could not be updated' : 'The app list could not be loaded'}
                  </p>
                )}
                <NoticeBanner />
              </header>
              <AppGrid apps={apps} onOpen={openApp} />
            </div>
          </main>
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-36 bg-gradient-to-t from-bg-elevated via-bg-elevated/80 to-transparent md:hidden" />
        </div>
      )}

      {open.map((app) => (
        <AppWindow
          key={app.url}
          app={app}
          state={active === app.url ? 'shown' : active === null ? 'home' : 'switch'}
          origin={origins[app.url]}
          floating={floating}
          onToggleFloating={toggleFloating}
          onMinimize={goHome}
          onClose={() => closeApp(app)}
        />
      ))}

      {admin && shownDetail && <Inspector route={shownDetail} leaving={detailLeaving} />}

      {settled && (
        <Dock
          open={open}
          closing={closing}
          active={active}
          underGrid={admin && active === null}
          hidden={detail !== null}
          onHome={goHome}
          onSelect={(app) => openApp(app, dockRect(app.url))}
          onClose={closeApp}
        />
      )}
    </div>
  )
}
