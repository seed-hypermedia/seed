import {hmId, useJoinSite, useRouteLink} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {displayHostname, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {FloatingAccountFooter} from '@shm/ui/floating-account-footer'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {JoinButton} from '@shm/ui/join-button'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {ReactNode, useMemo} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'

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
  siteUid,
  liftForPageFooter = false,
}: {
  children?: ReactNode
  siteUid: string
  liftForPageFooter?: boolean
}) {
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

  const {isJoined, joinSite} = useJoinSite({siteUid})

  let joinButton = null
  let accountButton = null
  if (keyPair) {
    accountButton = (
      <a {...profileLinkProps} className="flex rounded-full shadow-lg">
        <HMIcon
          id={account?.id ?? hmId(keyPair.id, {latest: true})}
          name={account?.metadata?.name}
          icon={account?.metadata?.icon}
          size={32}
        />
      </a>
    )
    if (!isJoined) {
      joinButton = <JoinButton onClick={() => joinSite()} />
    }
  } else {
    joinButton = <JoinButton onClick={() => createAccount()} />
  }
  return (
    <FloatingAccountFooter
      floatingButton={
        <>
          {accountButton}
          {joinButton}
        </>
      }
      extraContent={createAccountContent}
      liftForPageFooter={liftForPageFooter}
    >
      {children}
    </FloatingAccountFooter>
  )
}
