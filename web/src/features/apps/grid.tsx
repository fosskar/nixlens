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
  const sections = byCategory(apps).map(([category, list], i) => {
    const open = !collapsed.includes(category)
    return (
      // the order keeps categories in sequence where the columns dissolve
      <section key={category} style={{ order: i }}>
        <button
          onClick={() => toggle(category)}
          aria-expanded={open}
          className="group mb-4 flex w-full items-center gap-3 px-1 text-2xs font-semibold tracking-[0.12em] text-fg-muted uppercase transition-colors hover:text-fg-base"
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
          <span className="text-fg-muted tabular-nums">{list.length}</span>
          <span className="h-px flex-1 bg-gradient-to-r from-line to-transparent" />
        </button>
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className={open ? '' : 'overflow-hidden'}>
            <AppSection apps={list} onOpen={onOpen} />
          </div>
        </div>
      </section>
    )
  })
  // two columns that stack on their own, so a collapsed category frees its
  // space for the ones below it instead of keeping its neighbour's height;
  // categories alternate between them, and on narrow screens the columns
  // dissolve into one list
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      {[0, 1].map((column) => (
        <div key={column} className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-8">
          {sections.filter((_, i) => i % 2 === column)}
        </div>
      ))}
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
          className="group flex flex-col items-center gap-2.5 transition-transform duration-300 hover:-translate-y-1 active:scale-95"
        >
          <div className="relative">
            <AppIcon app={app} />
            {!app.frameable && (
              <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-line bg-bg-overlay/90 text-fg-base shadow-raised">
                <svg
                  viewBox="0 0 24 24"
                  className="h-2.5 w-2.5 fill-none stroke-current"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
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
