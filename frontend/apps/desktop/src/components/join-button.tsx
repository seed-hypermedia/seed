import {useJoinSpace} from '@shm/shared/models/join-space'
import {JoinButton as JoinButtonUI} from '@shm/ui/join-button'
import {useJoinSpaceIntent} from './desktop-intents'

export function JoinButton({spaceUid}: {spaceUid: string}) {
  const {isJoined, isPending, spaceName} = useJoinSpace({
    spaceUid,
  })
  const joinIntent = useJoinSpaceIntent(spaceUid, spaceName)

  if (isJoined) return null

  return (
    <>
      <JoinButtonUI onClick={joinIntent.join} disabled={isPending || joinIntent.isPending} />
      {joinIntent.content}
    </>
  )
}
