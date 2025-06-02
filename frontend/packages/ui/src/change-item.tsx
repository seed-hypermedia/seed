import {useRouteLink} from '@shm/shared'
import {getMetadataName} from '@shm/shared/content'
import {
  HMChangeSummary,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from './components/button'
import {HMIcon} from './hm-icon'
import {Version} from './icons'
import {cn} from './utils'

export function ChangeItem({
  change,
  isActive,
  isLast = false,
  isCurrent,
  docId,
  author,
}: {
  change: HMChangeSummary | any // Using any to handle the type mismatch from activity.tsx
  isActive: boolean
  isLast: boolean
  isCurrent: boolean
  docId: UnpackedHypermediaId
  author?: HMMetadataPayload | undefined
}) {
  // Handle both data structures: separate author prop (desktop) or embedded in change (web)
  const authorData = author || (change as any)?.author

  if (!authorData || !authorData.id) {
    console.warn('ChangeItem: no author data available', {change, author})
    return null
  }

  const iconSize = 20

  const linkProps = useRouteLink({
    key: 'document',
    id: {...docId, version: change.id, latest: false},
  })

  return (
    <Button
      key={change.id}
      variant="ghost"
      className={cn(
        'h-auto p-3 rounded-md items-start relative transition-colors gap-2',
        isActive
          ? 'bg-brand/10 hover:bg-brand/20'
          : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
      {...linkProps}
    >
      <div
        className={cn(
          'absolute w-px h-full bg-gray-300 dark:bg-gray-600 top-3.5 left-[22px] z-10',
          isLast ? 'opacity-0' : 'opacity-100',
        )}
      />

      <div className="flex-shrink-0 size-5 z-20 flex items-center justify-center bg-gray-800 rounded-full p-0.5">
        <Version size={16} color="white" />
      </div>
      <div
        className="flex-shrink-0"
        style={{width: iconSize, height: iconSize}}
      >
        <HMIcon
          size={iconSize}
          id={authorData.id}
          metadata={authorData.metadata}
        />
      </div>
      <div className="flex-1 flex flex-col">
        <div
          className="flex items-center gap-2 overflow-hidden w-full"
          style={{height: iconSize}}
        >
          <AuthorName author={authorData} />
          <span className="text-sm flex-shrink-0 font-light text-muted-foreground">
            {isCurrent ? 'current version' : 'version'}
          </span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-1 truncate text-left">
          {change.createTime ? formattedDateMedium(change.createTime) : ''}
        </span>
      </div>
    </Button>
  )
}

function AuthorName({author}: {author: HMMetadataPayload}) {
  const linkProps = useRouteLink({key: 'document', id: author.id})
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-sm flex-shrink-1 truncate font-bold hover:bg-gray-200 dark:hover:bg-gray-700 p-0 h-auto"
      {...linkProps}
    >
      {getMetadataName(author.metadata)}
    </Button>
  )
}
