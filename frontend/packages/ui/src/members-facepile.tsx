import {HMListDocumentCollaboratorsOutput, HMSiteMember, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccountsMetadata, useDocumentCollaborators} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useMemo} from 'react'
import {AccountAvatar} from './account-avatar'
import {getRenderedCollaboratorsCount} from './collaborators-page'
import {cn} from './utils'

const MAX_AVATARS = 3

interface MembersFacepileProps {
  members: HMSiteMember[]
  siteId: UnpackedHypermediaId
  description?: string
  className?: string
}

export function MembersFacepile({members, siteId, description, className}: MembersFacepileProps) {
  const totalCount = members.length

  const displayUids = useMemo(() => members.slice(0, MAX_AVATARS).map((m) => m.account.uid), [members])

  const accountsMeta = useAccountsMetadata(displayUids)

  const peopleLinkProps = useRouteLink({
    key: 'collaborators',
    id: {...siteId, latest: true, version: null},
  })

  if (totalCount === 0) return null

  return (
    <div
      className={cn(
        'bg-muted hover:bg-muted/80 flex cursor-pointer items-center gap-3 rounded-lg px-5 py-4 transition-colors',
        className,
      )}
    >
      <div className="flex -space-x-2">
        {displayUids.map((uid, idx) => {
          const member = members[idx]
          if (!member) return null
          const meta = accountsMeta.data[uid]
          return (
            <div key={uid} className="ring-muted rounded-full ring-2" style={{zIndex: MAX_AVATARS - idx}}>
              <AccountAvatar id={member.account} name={meta?.metadata?.name} icon={meta?.metadata?.icon} size={32} />
            </div>
          )
        })}
      </div>
      <a {...peopleLinkProps} className="text-muted-foreground text-sm hover:underline">
        {description || `${totalCount} member${totalCount !== 1 ? 's' : ''} collaborating`}
      </a>
    </div>
  )
}

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
