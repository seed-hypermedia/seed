import {HMMetadata, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {useImageUrl} from './get-file-url'
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
  const homeLinkProps = useRouteLink(
    {
      key: 'document',
      id,
    },
    {
      handler: 'onClick',
    },
  )
  if (metadata?.seedExperimentalLogo) {
    return (
      <div
        className={cn('flex flex-1 items-center justify-center')}
        style={{height: '60px'}}
      >
        <a
          {...homeLinkProps}
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
      className={cn('flex items-center justify-center gap-2')}
    >
      <HMIcon size={24} id={id} name={metadata?.name} icon={metadata?.icon} />
      <p
        className={cn(
          'text-foreground text-center font-bold select-none sm:text-left',
        )}
      >
        {metadata?.name}
      </p>
    </a>
  )
}
