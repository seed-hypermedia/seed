import {UnpackedHypermediaId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'

import {Link} from '@shm/ui/icons'
import {FontSizeTokens} from 'tamagui'

export function EntityLinkIcon({
  id,
  size = 20,
}: {
  id?: UnpackedHypermediaId
  size?: FontSizeTokens | number
}) {
  const entity = useResource(id)
  if (!id) return null
  return (
    <Link
      metadata={entity.data?.document?.metadata}
      size={size}
      id={id}
      error={!!entity.error}
    />
  )
}
