import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/scroll'
import { glass } from '@/components/ui'
import { AppGrid } from '@/features/apps/grid'
import { Inspector } from '@/features/inspector/inspector'
import { NoticeBanner } from '@/features/notice/notice'
import { useOverview } from '@/features/overview/machines'
import { OverviewWidget } from '@/features/overview/overview'
import { UserMenu } from '@/features/user/user'
import { useApps } from '@/features/apps/apps'
import { type Me, usePoll } from '@/lib/api'
import { reducedMotion } from '@/lib/prefs'
import { closeLayer, useRoute } from '@/lib/router'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'good night'
  if (h < 12) return 'good morning'
  if (h < 18) return 'good afternoon'
  return 'good evening'
}

export default function App() {
  const mePoll = usePoll<Me>('/api/me', 60000)
  const me = mePoll.data
  const settled = me !== undefined || mePoll.error !== undefined
  const admin = me?.admin ?? false
  const firstName = me?.name.split(' ')[0].toLowerCase()
  const overview = useOverview(admin)
  const machines = overview.data ?? []
  const { apps, error: appsError } = useApps()

  // the address decides what is in front: a detail panel or nothing over the
  // home view
  const route = useRoute()
  const detail = route.kind === 'machine' || route.kind === 'pool' || route.kind === 'disk' ? route : null

  // a closed detail panel stays until it has drawn back under the sidebar
  const [shownDetail, setShownDetail] = useState(detail)
  if (detail && detail !== shownDetail) setShownDetail(detail)
  const detailLeaving = detail === null && shownDetail !== null
  useEffect(() => {
    if (!detailLeaving) return
    const timer = setTimeout(() => setShownDetail(null), reducedMotion() ? 0 : 150)
    return () => clearTimeout(timer)
  }, [detailLeaving])

  // details for someone who may not see them lead home
  useEffect(() => {
    if (detail && me && !admin) closeLayer()
  }, [detail, me, admin])

  // names what is in front, so tabs and history tell views apart
  const title = admin && detail ? `${detail.machine} · nixlens` : 'nixlens'

  const online = machines.filter((m) => m.online).length

  return (
    <div className="min-h-screen text-fg-base">
      <title>{title}</title>
      {/* the layout depends on the sidebar, known once /api/me answers, so it
          is painted in its final place. on phones details cover the screen, and
          the home view goes while they are open instead of showing through */}
      {settled && (
        <div className={detail ? 'max-md:invisible' : undefined}>
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
            className={`nixlens-scroll-fade px-6 ${admin ? 'pt-8' : 'pt-[calc(4.5rem+var(--safe-top))]'} pb-[calc(3rem+var(--safe-bottom))] md:fixed md:inset-y-0 md:right-0 md:overflow-y-auto ${admin ? 'md:left-[23.5rem]' : 'md:left-0'} md:pt-[calc(4rem+var(--safe-top))]`}
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
              <AppGrid apps={apps} />
            </div>
          </main>
        </div>
      )}

      {admin && shownDetail && <Inspector route={shownDetail} leaving={detailLeaving} />}
    </div>
  )
}
