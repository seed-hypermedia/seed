import {useRouteLink} from '@shm/shared'
import {getMetadataName} from '@shm/shared/content'
import {
  HMChangeSummary,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useTx, useTxUtils} from '@shm/shared/translation'
import {Button} from './button'
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

  const linkProps = useRouteLink(
    {
      key: 'document',
      id: {...docId, version: change.id, latest: false},
    },
    {
      handler: 'onClick',
    },
  )

  return (
    <Button
      key={change.id}
      variant="ghost"
      className={cn(
        'relative flex h-auto w-full items-start justify-start gap-2 rounded-md p-3 transition-colors',
        isActive
          ? 'bg-brand-12 hover:bg-brand-11'
          : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
      {...linkProps}
    >
      <div
        className={cn(
          'absolute top-3.5 left-[21px] z-10 h-full w-px bg-gray-300 dark:bg-gray-600',
          isLast ? 'opacity-0' : 'opacity-100',
        )}
      />

      <div className="z-20 flex size-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 p-0.5">
        <Version size={16} color="white" />
      </div>
      <div
        className="flex-shrink-0"
        style={{width: iconSize, height: iconSize}}
      >
        <HMIcon size={iconSize} id={author.id} metadata={author.metadata} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div
          className="flex flex-1 items-center gap-2 overflow-hidden"
          style={{height: iconSize}}
        >
          <AuthorName author={author} />
          <span className="text-muted-foreground flex-shrink-0 text-sm font-light">
            {isCurrent ? tx('current version') : tx('version')}
          </span>
        </div>
        <span className="text-muted-foreground flex-shrink-1 truncate text-left text-xs">
          {change.createTime ? formattedDateMedium(change.createTime) : ''}
        </span>
      </div>
    </Button>
  )
}

function AuthorName({author}: {author: HMMetadataPayload}) {
  const linkProps = useRouteLink(
    {key: 'document', id: author.id},
    {
      handler: 'onClick',
    },
  )
  return (
    // @ts-expect-error
    <a
      className="h-auto flex-shrink-1 truncate p-0 text-sm font-bold hover:bg-gray-200 dark:hover:bg-gray-700"
      {...linkProps}
    >
      {getMetadataName(author.metadata)}
    </a>
  )
}
