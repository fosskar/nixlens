import { useState } from 'react'
import { type App } from '@/lib/api'

const dashboardIcons = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons'

type IconSource = { url: string; mask: boolean }

function iconSource(icon: string): IconSource | null {
  if (icon === '') return null
  if (/^(https?:\/\/|\/)/.test(icon)) return { url: icon, mask: false }
  if (icon.startsWith('sh-'))
    return { url: `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${icon.slice(3)}.svg`, mask: false }
  if (icon.startsWith('mdi-'))
    return { url: `https://cdn.jsdelivr.net/npm/@mdi/svg/svg/${icon.slice(4)}.svg`, mask: true }
  const ext = /\.(svg|png|webp)$/.exec(icon)?.[1]
  if (ext) return { url: `${dashboardIcons}/${ext}/${icon}`, mask: false }
  return { url: `${dashboardIcons}/svg/${icon}.svg`, mask: false }
}

const iconSizes = {
  lg: { box: 'h-16 w-16 rounded-2xl', img: 'h-10 w-10', letter: 'text-2xl' },
  sm: { box: 'h-11 w-11 rounded-xl', img: 'h-7 w-7', letter: 'text-lg' },
  xs: { box: 'h-6 w-6 rounded-md', img: 'h-4 w-4', letter: 'text-[11px]' },
}

export function AppIcon({ app, size = 'lg' }: { app: App; size?: keyof typeof iconSizes }) {
  const source = iconSource(app.icon)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const s = iconSizes[size]
  const failed = source === null || failedUrl === source.url
  const onError = () => source && setFailedUrl(source.url)
  return (
    <div className={`${s.box} glass-tile grid place-items-center`}>
      {failed ? (
        <span className={`${s.letter} font-semibold text-fg-base`}>{app.name.charAt(0).toUpperCase()}</span>
      ) : source.mask ? (
        <>
          <img src={source.url} alt="" hidden onError={onError} />
          <span
            className={`${s.img} bg-fg-base`}
            style={{
              maskImage: `url("${source.url}")`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
            }}
          />
        </>
      ) : (
        <img src={source.url} alt="" className={`${s.img} object-contain`} onError={onError} />
      )}
    </div>
  )
}
