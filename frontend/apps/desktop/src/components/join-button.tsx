import {useJoinSite} from '@shm/shared/models/join-site'
import {JoinButton as JoinButtonUI} from '@shm/ui/join-button'
import {useJoinSiteIntent} from './desktop-intents'

export function JoinButton({siteUid}: {siteUid: string}) {
  const {isJoined, isPending, siteName} = useJoinSite({
    siteUid,
  })
  const joinIntent = useJoinSiteIntent(siteUid, siteName)

  if (isJoined) return null

  return (
    <>
      <JoinButtonUI onClick={joinIntent.join} disabled={isPending || joinIntent.isPending} />
      {joinIntent.content}
    </>
  )
}
