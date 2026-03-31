import {useSetSubscription} from '@/models/subscription'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useJoinSite} from '@shm/shared/models/join-site'
import {JoinButton as JoinButtonUI} from '@shm/ui/join-button'
import {toast} from '@shm/ui/toast'

export function JoinButton({siteUid}: {siteUid: string}) {
  const {isJoined, isPending, siteName, joinSite} = useJoinSite({
    siteUid,
  })
  const setSubscription = useSetSubscription()

  if (isJoined) return null

  const handleJoin = () => {
    joinSite()
      .then(() => {
        // Also subscribe to the full site for P2P syncing
        setSubscription.mutate({
          id: hmId(siteUid),
          subscribed: true,
          recursive: true,
        })
        toast.success(`Joined ${siteName || 'site'}`)
      })
      .catch((error) => {
        console.error('Failed to join:', error)
        toast.error('Failed to join')
      })
  }

  return <JoinButtonUI onClick={handleJoin} disabled={isPending || setSubscription.isPending} />
}
