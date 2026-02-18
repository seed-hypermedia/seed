import {hostnameStripProtocol} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {useRef} from 'react'

export function HypermediaHostBanner({origin}: {origin?: string}) {
  const bannerRef = useRef<HTMLDivElement>(null)

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return

    const updateBannerHeight = () => {
      const banners = Array.from(
        window.document.querySelectorAll<HTMLElement>('[data-hm-host-banner]'),
      )
      const maxBannerHeight = banners.reduce(
        (maxHeight, banner) => Math.max(maxHeight, banner.offsetHeight),
        0,
      )
      window.document.documentElement.style.setProperty(
        '--hm-host-banner-h',
        `${maxBannerHeight}px`,
      )
    }

    updateBannerHeight()

    const resizeObserver = new ResizeObserver(() => {
      updateBannerHeight()
    })
    if (bannerRef.current) {
      resizeObserver.observe(bannerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      updateBannerHeight()
    }
  }, [])

  return (
    <div
      ref={bannerRef}
      data-hm-host-banner="true"
      className="bg-primary w-full p-1"
    >
      <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-white">
        <span>Hosted on</span>
        <a href="/" className="underline">
          {hostnameStripProtocol(origin)}
        </a>
        <span>via the</span>
        <a href="https://hyper.media" target="_blank" className="underline">
          Hypermedia Protocol
        </a>
      </p>
    </div>
  )
}
