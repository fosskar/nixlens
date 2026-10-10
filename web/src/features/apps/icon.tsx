import { useState } from 'react'
import { type App } from '@/lib/api'

type IconSource = { url: string; mask: boolean }

function iconSource(icon: string): IconSource | null {
  if (icon === '') return null
  if (/^(https?:\/\/|\/)/.test(icon)) return { url: icon, mask: false }
  // the hub fetches and keeps icons from the icon sets; without an extension
  // it takes the svg, or the png where there is none
  if (icon.startsWith('sh-')) return { url: `/api/icons/selfhst/${encodeURIComponent(icon.slice(3))}`, mask: false }
  if (icon.startsWith('mdi-')) return { url: `/api/icons/mdi/${encodeURIComponent(icon.slice(4))}.svg`, mask: true }
  return { url: `/api/icons/dashboard/${encodeURIComponent(icon)}`, mask: false }
}

export function AppIcon({ app }: { app: App }) {
  const source = iconSource(app.icon)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = source === null || failedUrl === source.url
  const onError = () => source && setFailedUrl(source.url)
  return (
    <div className="glass-tile grid h-16 w-16 place-items-center rounded-card">
      {failed ? (
        <span className="text-2xl font-semibold text-fg-base">{app.name.charAt(0).toUpperCase()}</span>
      ) : source.mask ? (
        <>
          <img src={source.url} alt="" hidden onError={onError} />
          <span
            className="h-10 w-10 bg-fg-base"
            style={{
              maskImage: `url("${source.url}")`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
            }}
          />
        </>
      ) : (
        <img
          src={source.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-10 w-10 object-contain"
          onError={onError}
        />
      )}
    </div>
  )
}
