import {HMSiteMember, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccountsMetadata} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {useMemo} from 'react'
import {HMIcon} from './hm-icon'
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

  if (totalCount === 0) return null

  const displayUids = useMemo(() => members.slice(0, MAX_AVATARS).map((m) => m.account.uid), [members])

  const accountsMeta = useAccountsMetadata(displayUids)
  const remainingCount = totalCount - MAX_AVATARS

  const peopleLinkProps = useRouteLink({
    key: 'collaborators',
    id: {...siteId, latest: true, version: null},
  })

  return (
    <a
      {...peopleLinkProps}
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
              <HMIcon id={member.account} name={meta?.metadata?.name} icon={meta?.metadata?.icon} size={32} />
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 text-sm">
        {remainingCount > 0 && (
          <span className="rounded-md bg-white px-2 py-0.5 font-bold dark:bg-neutral-700">+{remainingCount}</span>
        )}{' '}
        <span className="text-muted-foreground">
          {description || `${totalCount} member${totalCount !== 1 ? 's' : ''} collaborating`}
        </span>
      </div>
    </a>
  )
}
