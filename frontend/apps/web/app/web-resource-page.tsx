import {
  hmId,
  UnpackedHypermediaId,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {HMIcon} from '@shm/ui/hm-icon'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {CircleUser} from 'lucide-react'
import {useMemo} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'

export interface WebResourcePageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
}

/**
 * Web-specific wrapper for ResourcePage that handles:
 * - HypermediaHostBanner (shown when viewing content from a different site)
 * - Account button with login/create account flow
 */
export function WebResourcePage({docId, CommentEditor}: WebResourcePageProps) {
  const {origin, originHomeId} = useUniversalAppContext()

  const {accountButton, extraContent} = useWebAccountButton()

  // Show banner when viewing content from a different site than the host
  const siteUid = docId.uid
  const showBanner = origin && originHomeId && siteUid !== originHomeId.uid

  return (
    <>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <ResourcePage docId={docId} CommentEditor={CommentEditor} />
      <div className="fixed bottom-4 left-4 z-30">{accountButton}</div>
      {extraContent}
    </>
  )
}

function useWebAccountButton() {
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
