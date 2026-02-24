import {hmId, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {displayHostname, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {cn} from '@shm/ui/utils'
import {CircleUser} from 'lucide-react'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'

export function useWebAccountButton() {
  const keyPair = useLocalKeyPair()

  const myAccount = useAccount(keyPair?.id || undefined, {
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
  })

  const {content: createAccountContent, createAccount} = useCreateAccount({
    onClose: () => {
      setTimeout(() => {
        myAccount.refetch()
      }, 500)
    },
  })

  const account = useMemo(() => {
    if (!myAccount.data?.id) return null
    return {
      id: hmId(myAccount.data.id.uid, {latest: true}),
      metadata: myAccount.data.metadata ?? undefined,
    }
  }, [myAccount.data])

  const profileLinkProps = useRouteLink(
    keyPair
      ? {
          key: 'profile',
          id: hmId(keyPair.id, {latest: true}),
        }
      : null,
  )

  const accountButton = account?.id ? (
    <a {...profileLinkProps} className="flex rounded-full shadow-lg">
      <HMIcon id={account.id} name={account.metadata?.name} icon={account.metadata?.icon} size={32} />
    </a>
  ) : (
    <button
      className="flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800"
      onClick={() => createAccount()}
    >
      <CircleUser className="size-4" />
      Join
    </button>
  )

  return {
    accountButton,
    extraContent: createAccountContent,
  }
}

export function useWebMenuItems(): MenuItemType[] {
  const route = useNavRoute()
  const gwUrl = DEFAULT_GATEWAY_URL
  const gatewayLink = useMemo(() => routeToUrl(route, {hostname: gwUrl}), [route, gwUrl])

  return useMemo(
    () => [
      {
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-4" />,
        onClick: () => {
          if (typeof window !== 'undefined') {
            copyUrlToClipboardWithFeedback(window.location.href, 'Link')
          }
        },
      },
      {
        key: 'copy-gateway-link',
        label: `Copy ${displayHostname(gwUrl)} Link`,
        icon: <Link className="size-4" />,
        onClick: () => {
          if (gatewayLink) {
            copyUrlToClipboardWithFeedback(gatewayLink, 'Link')
          }
        },
      },
    ],
    [gwUrl, gatewayLink],
  )
}

export function WebAccountFooter({
  children,
  liftForPageFooter = false,
}: {
  children?: ReactNode
  liftForPageFooter?: boolean
}) {
  const {accountButton, extraContent} = useWebAccountButton()
  const [footerLiftPx, setFooterLiftPx] = useState(0)

  useEffect(() => {
    if (!liftForPageFooter || typeof window === 'undefined') {
      setFooterLiftPx(0)
      return
    }

    let pageFooter: HTMLElement | null = null
    let intersectionObserver: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null

    const cleanupObservers = () => {
      intersectionObserver?.disconnect()
      resizeObserver?.disconnect()
      intersectionObserver = null
      resizeObserver = null
    }

    const attachToFooter = () => {
      const nextFooter = document.querySelector<HTMLElement>('[data-page-footer="true"]')
      if (!nextFooter || nextFooter === pageFooter) return

      cleanupObservers()
      pageFooter = nextFooter

      const updateLift = (isVisible: boolean) => {
        if (!pageFooter || !isVisible) {
          setFooterLiftPx(0)
          return
        }
        // Keep the floating account button above the currently visible footer.
        setFooterLiftPx(Math.ceil(pageFooter.getBoundingClientRect().height) + 8)
      }

      intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[0]
        updateLift(!!entry?.isIntersecting)
      })
      intersectionObserver.observe(pageFooter)

      resizeObserver = new ResizeObserver(() => {
        const rect = pageFooter?.getBoundingClientRect()
        if (!rect) return
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          updateLift(true)
        }
      })
      resizeObserver.observe(pageFooter)
    }

    attachToFooter()

    const mutationObserver = new MutationObserver(() => {
      attachToFooter()
    })
    mutationObserver.observe(document.body, {childList: true, subtree: true})

    return () => {
      mutationObserver.disconnect()
      cleanupObservers()
    }
  }, [liftForPageFooter])

  return (
    <>
      {children}
      <div
        style={{bottom: `calc(1rem + ${footerLiftPx}px)`}}
        className={cn('fixed left-4 z-30 transition-[bottom] duration-200')}
      >
        {accountButton}
      </div>
      {extraContent}
    </>
  )
}
