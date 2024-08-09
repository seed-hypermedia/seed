import {UnpackedHypermediaId, useHover} from '@shm/shared'
import {Button, Star, StarFull, Tooltip} from '@shm/ui'

import {ComponentProps} from 'react'
import {useFavorite} from '../models/favorites'

function RemoveFavoriteButton({
  onPress,
}: {
  onPress: ComponentProps<typeof Button>['onPress']
}) {
  const hover = useHover()
  return (
    <Tooltip content="Remove from Favorites">
      <Button
        {...hover}
        size="$2"
        icon={hover.hover ? Star : StarFull}
        onPress={onPress}
        color={hover.hover ? undefined : '$yellow10'}
        theme={hover.hover ? 'red' : undefined}
        chromeless
        backgroundColor="$colorTransparent"
      />
    </Tooltip>
  )
}

export function FavoriteButton({
  id,
  hideUntilItemHover,
}: {
  id: UnpackedHypermediaId
  hideUntilItemHover?: boolean
}) {
  const favorite = useFavorite(id)
  if (favorite.isFavorited) {
    return (
      <RemoveFavoriteButton
        onPress={(e: MouseEvent) => {
          e.stopPropagation()
          favorite.removeFavorite()
        }}
      />
    )
  }
  return (
    <Tooltip content="Add To Favorites">
      <Button
        icon={Star}
        size="$2"
        opacity={hideUntilItemHover ? 0 : 1}
        $group-item-hover={{opacity: 1}}
        onPress={(e: MouseEvent) => {
          e.stopPropagation()
          favorite.addFavorite()
        }}
      />
    </Tooltip>
  )
}

export function useFavoriteMenuItem(url: string | null) {
  const favorite = useFavorite(url)
  return {
    key: 'toggleFavorite',
    label: favorite.isFavorited ? 'Remove from Favorites' : 'Add to Favorites',
    icon: Star,
    onPress: () => {
      favorite.isFavorited ? favorite.removeFavorite() : favorite.addFavorite()
    },
  }
}
