import {hmId, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {createWebHMUrl, displayHostname} from '@shm/shared/utils/entity-id-url'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {CircleUser} from 'lucide-react'
import {ReactNode, useMemo} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'

export function useWebAccountButton() {
  const keyPair = useLocalKeyPair()

  const myAccount = useAccount(keyPair?.id || undefined, {
    retry: 3,
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 30000),
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
      <HMIcon
        id={account.id}
        name={account.metadata?.name}
        icon={account.metadata?.icon}
        size={32}
      />
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

export function useWebMenuItems(docId: UnpackedHypermediaId): MenuItemType[] {
  const gwUrl = DEFAULT_GATEWAY_URL
  const gatewayLink = useMemo(
    () =>
      createWebHMUrl(docId.uid, {
        path: docId.path,
        hostname: gwUrl,
      }),
    [docId.uid, docId.path, gwUrl],
  )

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

export function WebAccountFooter({children}: {children?: ReactNode}) {
  const {accountButton, extraContent} = useWebAccountButton()
  return (
    <>
      {children}
      <div className="fixed bottom-4 left-4 z-30">{accountButton}</div>
      {extraContent}
    </>
  )
}
