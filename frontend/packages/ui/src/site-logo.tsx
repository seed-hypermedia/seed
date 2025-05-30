import {HMMetadata, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {useImageUrl} from '@shm/ui/get-file-url'
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
  const homeLinkProps = useRouteLink({
    key: 'document',
    id,
  })
  if (metadata?.seedExperimentalLogo) {
    return (
      <div
        {...homeLinkProps}
        className={cn('flex flex-1 items-center justify-center')}
        style={{height: '60px'}}
      >
        <img
          src={imageUrl(metadata.seedExperimentalLogo, 'M')}
          height={60}
          style={{objectFit: 'contain', height: '100%'}}
        />
      </div>
    )
  }
  return (
    <div
      {...homeLinkProps}
      className={cn('flex items-center justify-center gap-2')}
    >
      <HMIcon size={24} id={id} metadata={metadata} />
      <p
        className={cn(
          'select-none font-bold text-foreground text-center sm:text-left',
        )}
      >
        {metadata?.name}
      </p>
    </div>
  )
}
