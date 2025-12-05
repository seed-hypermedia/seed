import {HMMetadata, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {useImageUrl} from './get-file-url'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {cn} from './utils'

export function SiteLogo({
  id,
  metadata,
}: {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
}) {
  const imageUrl = useImageUrl()
  const highlighter = useHighlighter()
  const homeLinkProps = useRouteLink({
    key: 'document',
    id: {
      ...id,
      latest: true,
      version: null,
    },
  })
  if (metadata?.seedExperimentalLogo) {
    return (
      <div
        className={cn('flex flex-1 items-center justify-center')}
        style={{height: '60px'}}
        {...highlighter(id)}
      >
        <a
          {...homeLinkProps}
          data-resourceid={id.id}
          className="flex h-full items-center justify-center"
        >
          <img
            src={imageUrl(metadata.seedExperimentalLogo, 'M')}
            height={60}
            style={{objectFit: 'contain', height: '100%'}}
          />
        </a>
      </div>
    )
  }
  return (
    <a
      {...homeLinkProps}
      data-resourceid={id.id}
      className={cn('flex min-w-0 items-center justify-center gap-2')}
      {...highlighter(id)}
    >
      <HMIcon size={24} id={id} name={metadata?.name} icon={metadata?.icon} />
      <p
        className={cn(
          'text-foreground min-w-0 truncate overflow-hidden text-center font-bold select-none md:text-left',
        )}
      >
        {metadata?.name}
      </p>
    </a>
  )
}
