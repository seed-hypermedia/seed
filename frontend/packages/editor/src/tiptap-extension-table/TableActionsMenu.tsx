import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {SizableText} from '@shm/ui/text'

export type TableMenuItem = {
  key: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}

/**
 * Floating action menu for the table row / column strips.
 */
export function TableActionsMenu({
  open,
  onOpenChange,
  items,
  align = 'start',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: TableMenuItem[]
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span
          aria-hidden
          style={{display: 'block', width: 1, height: 1, pointerEvents: 'none'}}
          data-table-menu-anchor
        />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side="bottom"
        className="w-auto min-w-[12rem] p-1"
        // Keep focus in the editor.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left disabled:pointer-events-none disabled:opacity-50"
              // Don't let the press blur the editor or move the caret.
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation()
                if (item.disabled) return
                item.onClick?.()
                onOpenChange(false)
              }}
            >
              {item.icon}
              <SizableText>{item.label}</SizableText>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
