import {UnpackedHypermediaId} from '@shm/shared'
import {useHover} from '@shm/shared/use-hover'
import {Button} from '@shm/ui/button'
import {Star} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Bookmark} from 'lucide-react'
import {ComponentProps} from 'react'
import {useBookmark} from '../models/bookmarks'

function RemoveBookmarkButton({
  onClick,
  active,
  className,
}: {
  onClick: ComponentProps<typeof Button>['onClick']
  active?: boolean
  className?: string
}) {
  const {hover, ...hoverProps} = useHover()
  return (
    <Tooltip content="Remove from Bookmarks">
      <Button
        size="icon"
        variant={active ? 'default' : 'ghost'}
        {...hoverProps}
        onClick={onClick}
        className={cn('no-window-drag', active && 'bg-transparent shadow-none', className)}
      >
        <Bookmark className="size-3.5 fill-current" />
      </Button>
    </Tooltip>
  )
}

export function BookmarkButton({
  id,
  hideUntilItemHover,
  active,
  className,
}: {
  id: UnpackedHypermediaId
  hideUntilItemHover?: boolean
  active?: boolean
  className?: string
}) {
  const bookmark = useBookmark(id)
  if (bookmark.isBookmarked) {
    return (
      <RemoveBookmarkButton
        active={active}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          bookmark.removeBookmark()
        }}
      />
    )
  }
  return (
    <Tooltip content="Add To Bookmarks">
      <Button
        size="icon"
        variant={active ? 'default' : 'ghost'}
        className={cn(
          'no-window-drag',
          hideUntilItemHover && 'opacity-0 group-hover:opacity-100',
          'bg-transparent shadow-none',
          className,
        )}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation()
          bookmark.addBookmark()
        }}
      >
        <Bookmark className="stroke-foreground text-foreground size-3.5 dark:stroke-white dark:text-white" />
      </Button>
    </Tooltip>
  )
}

export function useBookmarkMenuItem(url: string | null) {
  const bookmark = useBookmark(url)
  return {
    key: 'toggleBookmark',
    label: bookmark.isBookmarked ? 'Remove from Bookmarks' : 'Add to Bookmarks',
    icon: <Star className="size-4 stroke-white" />,
    onClick: () => {
      bookmark.isBookmarked ? bookmark.removeBookmark() : bookmark.addBookmark()
    },
  }
}
