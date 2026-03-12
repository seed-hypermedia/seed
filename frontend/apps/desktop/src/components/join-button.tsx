import {useJoinSite} from '@shm/shared/models/join-site'
import {JoinButton as JoinButtonUI} from '@shm/ui/join-button'
import {toast} from '@shm/ui/toast'

export function JoinButton({siteUid}: {siteUid: string}) {
  const {isJoined, isPending, siteName, joinSite} = useJoinSite({
    siteUid,
  })

  if (isJoined) return null

  const handleJoin = () => {
    joinSite()
      .then(() => {
        toast.success(`Joined ${siteName || 'site'}`)
      })
      .catch((error) => {
        console.error('Failed to join:', error)
        toast.error('Failed to join')
      })
  }

  return <JoinButtonUI onClick={handleJoin} disabled={isPending} />
}
