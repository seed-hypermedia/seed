import {useRouteLink} from '@shm/shared'
import {getMetadataName} from '@shm/shared/content'
import {
  HMChangeSummary,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useTx, useTxUtils} from '@shm/shared/translation'
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
  const tx = useTx()
  const {formattedDateMedium} = useTxUtils()

  if (!author || !author.id) {
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
        'justify-start items-start relative h-auto p-3 rounded-md transition-colors gap-2 flex w-full',
        isActive
          ? 'bg-brand-12 hover:bg-brand-11'
          : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
      {...linkProps}
    >
      <div
        className={cn(
          'absolute w-px h-full bg-gray-300 dark:bg-gray-600 top-3.5 left-[21px] z-10',
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
        <HMIcon size={iconSize} id={author.id} metadata={author.metadata} />
      </div>
      <div className="flex flex-col flex-1 overflow-hidden">
        <div
          className="flex items-center flex-1 gap-2 overflow-hidden"
          style={{height: iconSize}}
        >
          <AuthorName author={author} />
          <span className="flex-shrink-0 text-sm font-light text-muted-foreground">
            {isCurrent ? tx('current version') : tx('version')}
          </span>
        </div>
        <span className="text-xs text-left truncate text-muted-foreground flex-shrink-1">
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
      className="h-auto p-0 text-sm font-bold truncate flex-shrink-1 hover:bg-gray-200 dark:hover:bg-gray-700"
      {...linkProps}
    >
      {getMetadataName(author.metadata)}
    </Button>
  )
}
