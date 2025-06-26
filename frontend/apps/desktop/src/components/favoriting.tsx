import {UnpackedHypermediaId} from '@shm/shared'
import {useHover} from '@shm/shared/use-hover'
import {Button} from '@shm/ui/button'
import {Star, StarFull} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {ComponentProps} from 'react'
import {useFavorite} from '../models/favorites'

function RemoveFavoriteButton({
  onClick,
  active,
}: {
  onClick: ComponentProps<typeof Button>['onClick']
  active?: boolean
}) {
  const {hover, ...hoverProps} = useHover()
  return (
    <Tooltip content="Remove from Favorites">
      <Button
        size="icon"
        variant={active ? 'default' : 'ghost'}
        {...hoverProps}
        onClick={onClick}
        className={cn(
          'no-window-drag',
          active && 'hover:bg-primary bg-red-500',
        )}
      >
        <StarFull color="var(--color-yellow-500)" />
      </Button>
    </Tooltip>
  )
}

export function FavoriteButton({
  id,
  hideUntilItemHover,
  active,
}: {
  id: UnpackedHypermediaId
  hideUntilItemHover?: boolean
  active?: boolean
}) {
  const favorite = useFavorite(id)
  if (favorite.isFavorited) {
    return (
      <RemoveFavoriteButton
        active={active}
        onClick={(e) => {
          e.stopPropagation()
          favorite.removeFavorite()
        }}
      />
    )
  }
  return (
    <Tooltip content="Add To Favorites">
      <Button
        size="icon"
        variant={active ? 'default' : 'ghost'}
        className={cn(
          'no-window-drag',
          hideUntilItemHover && 'opacity-0 group-hover:opacity-100',
          'bg-transparent shadow-none hover:bg-transparent',
        )}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation()
          favorite.addFavorite()
        }}
      >
        <Star className="stroke-foreground text-foreground size-4 dark:stroke-white dark:text-white" />
      </Button>
    </Tooltip>
  )
}

export function useFavoriteMenuItem(url: string | null) {
  const favorite = useFavorite(url)
  return {
    key: 'toggleFavorite',
    label: favorite.isFavorited ? 'Remove from Favorites' : 'Add to Favorites',
    icon: <Star className="size-4 stroke-white" />,
    onClick: () => {
      favorite.isFavorited ? favorite.removeFavorite() : favorite.addFavorite()
    },
  }
}
