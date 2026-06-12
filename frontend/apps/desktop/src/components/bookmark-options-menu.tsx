import React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {SidebarMenuAction} from '@shm/ui/components/sidebar'
import {MoreHorizontal, Trash2} from 'lucide-react'

/** Three-dot menu for actions on a bookmark sidebar item. */
export function BookmarkOptionsMenu({onDeleteBookmark, disabled}: {onDeleteBookmark: () => void; disabled?: boolean}) {
  return (
    <DropdownMenu>
      <SidebarMenuAction asChild>
        <DropdownMenuTrigger
          aria-label="Bookmark options"
          className="hover:bg-sidebar-accent flex items-center justify-center rounded-md p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
      </SidebarMenuAction>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem
          variant="destructive"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onDeleteBookmark()
          }}
        >
          <Trash2 className="size-4" />
          Delete Bookmark
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
