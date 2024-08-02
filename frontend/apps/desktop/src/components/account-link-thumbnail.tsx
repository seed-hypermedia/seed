import {useEntity} from '@/models/entities'
import {UnpackedHypermediaId} from '@shm/shared'
import {FontSizeTokens} from '@shm/ui'
import {LinkThumbnail} from './thumbnail'

export function EntityLinkThumbnail({
  id,
  size = 20,
}: {
  id?: UnpackedHypermediaId
  size?: FontSizeTokens | number
}) {
  const entity = useEntity(id)
  if (!id) return null
  return (
    <LinkThumbnail
      document={entity.data?.document}
      size={size}
      id={id}
      error={!!entity.error}
    />
  )
}
