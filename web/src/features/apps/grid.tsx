import { type MouseEvent } from 'react'
import { AppIcon } from '@/features/apps/icon'
import { type App } from '@/lib/api'
import { setPrefs, usePrefs } from '@/lib/prefs'

function byCategory(apps: App[]): [string, App[]][] {
  const groups = new Map<string, App[]>()
  for (const app of apps) {
    const list = groups.get(app.category)
    if (list) list.push(app)
    else groups.set(app.category, [app])
  }
  return [...groups]
}

export function AppGrid({ apps, onOpen }: { apps: App[]; onOpen: (app: App, from: DOMRect) => void }) {
  const { collapsed } = usePrefs()
  const toggle = (category: string) =>
    setPrefs({
      collapsed: collapsed.includes(category) ? collapsed.filter((c) => c !== category) : [...collapsed, category],
    })
  return (
    <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-2">
      {byCategory(apps).map(([category, list]) => {
        const open = !collapsed.includes(category)
        return (
          <section key={category}>
            <button
              onClick={() => toggle(category)}
              aria-expanded={open}
              className="group mb-4 flex w-full items-center gap-3 px-1 text-[11px] font-semibold tracking-[0.12em] text-fg-muted uppercase transition-colors hover:text-fg-base"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 shrink-0 fill-none stroke-current transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              {category || 'Other'}
              <span className="text-fg-dim tabular-nums">{list.length}</span>
              <span className="h-px flex-1 bg-gradient-to-r from-white/[0.10] to-transparent" />
            </button>
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className={open ? '' : 'overflow-hidden'}>
                <AppSection apps={list} onOpen={onOpen} />
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function appTitle(app: App): string {
  const title = `${app.name} on ${app.machine}${app.frameable ? '' : ' (opens in a new tab)'}`
  return app.description ? `${title}\n${app.description}` : title
}

function AppSection({ apps, onOpen }: { apps: App[]; onOpen: (app: App, from: DOMRect) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-y-6">
      {apps.map((app) => (
        <button
          key={app.url}
          onClick={(e: MouseEvent<HTMLButtonElement>) =>
            onOpen(app, (e.currentTarget.firstElementChild ?? e.currentTarget).getBoundingClientRect())
          }
          title={appTitle(app)}
          className="group flex flex-col items-center gap-2.5 transition-transform duration-300 ease-out hover:-translate-y-1 active:scale-95"
        >
          <div className="relative">
            <AppIcon app={app} />
            {!app.frameable && (
              <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-bg-overlay/90 text-[10px] text-fg-base shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_2px_6px_rgb(0_0_0/0.5)]">
                ↗
              </span>
            )}
          </div>
          <span className="max-w-full truncate px-1 text-xs text-fg-muted transition-colors group-hover:text-fg-inverse">
            {app.name}
          </span>
        </button>
      ))}
    </div>
  )
}
