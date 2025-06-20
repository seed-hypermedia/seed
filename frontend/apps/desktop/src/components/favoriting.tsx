import {UnpackedHypermediaId} from '@shm/shared'
import {useHover} from '@shm/shared/use-hover'
import {Button} from '@shm/ui/legacy/button'
import {Tooltip} from '@shm/ui/tooltip'
import {Star, StarFull} from '@tamagui/lucide-icons'
import {ComponentProps} from 'react'
import {GestureResponderEvent} from 'react-native'
import {useFavorite} from '../models/favorites'

function RemoveFavoriteButton({
  onPress,
}: {
  onPress: ComponentProps<typeof Button>['onPress']
}) {
  const {hover, ...hoverProps} = useHover()
  return (
    <Tooltip content="Remove from Favorites">
      <Button
        {...hoverProps}
        size="$2"
        icon={StarFull}
        onPress={onPress}
        color={hover ? '$yellow8' : '$yellow10'}
        className="no-window-drag"
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
        onPress={(e: GestureResponderEvent) => {
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
        className="no-window-drag"
        backgroundColor="$colorTransparent"
        chromeless
        hoverStyle={{
          backgroundColor: '$color3',
        }}
        opacity={hideUntilItemHover ? 0 : 1}
        $group-item-hover={{opacity: 1}}
        onPress={(e: GestureResponderEvent) => {
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
