import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {SizableText} from '@shm/ui/text'

export type TableMenuItem = {
  key: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}

export function TableActionsMenu({
  open,
  onOpenChange,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: TableMenuItem[]
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{display: 'block', width: 1, height: 1, pointerEvents: 'none'}}
          data-table-menu-anchor
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="p-1">
        <div className="flex flex-col">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              disabled={item.disabled}
              onClick={(event) => {
                event.stopPropagation()
                if (item.disabled) return
                item.onClick?.()
                onOpenChange(false)
              }}
            >
              {item.icon}
              <SizableText>{item.label}</SizableText>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
