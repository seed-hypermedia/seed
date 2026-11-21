import {HMListDocumentCollaboratorsOutput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDocumentCollaborators} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {AccountAvatar} from './account-avatar'
import {getRenderedCollaboratorsCount} from './collaborators-page'

const MAX_AVATARS = 3

/** Returns the account rows used by the document's People list, in the same order. */
export function getCommentAudienceAccountUids(
  collaborators: HMListDocumentCollaboratorsOutput,
  isSiteRoot: boolean,
): string[] {
  const accountUids = isSiteRoot
    ? [...collaborators.grantedMembers, ...collaborators.members].map((member) => member.account.uid)
    : [...collaborators.parentCapabilities, ...collaborators.grantedCapabilities].map(
        (capability) => capability.accountUid,
      )
  return [collaborators.publisherUid, ...accountUids.filter((uid) => collaborators.accounts[uid])]
}

/** Shows the document People count and opens its collaborators in the right panel. */
export function CommentAudience({docId}: {docId: UnpackedHypermediaId}) {
  const collaborators = useDocumentCollaborators(docId)
  const data = collaborators.data
  const isSiteRoot = !docId.path?.length
  const count = getRenderedCollaboratorsCount(data, isSiteRoot)
  const accountUids = data ? getCommentAudienceAccountUids(data, isSiteRoot) : []
  const membersLink = useRouteLink({
    key: 'document',
    id: docId,
    panel: {key: 'collaborators', id: docId},
  })

  if (!data || collaborators.isError) return null

  return (
    <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
      {accountUids.length > 0 && (
        <div className="flex shrink-0 -space-x-2">
          {accountUids.slice(0, MAX_AVATARS).map((uid, index) => {
            const account = data?.accounts[uid]
            return (
              <div key={uid} className="ring-background rounded-full ring-2" style={{zIndex: MAX_AVATARS - index}}>
                <AccountAvatar
                  id={hmId(uid)}
                  name={account?.metadata?.name}
                  icon={account?.metadata?.icon}
                  size={20}
                  siteUid={docId.uid}
                />
              </div>
            )
          })}
        </div>
      )}
      <span>
        <a {...membersLink} className="text-link hover:underline">
          {count} {count === 1 ? 'member' : 'members'}
        </a>{' '}
        will see the comment
      </span>
    </div>
  )
}
