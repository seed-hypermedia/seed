import {MoreHorizontal} from 'lucide-react'
import {ButtonProps, buttonVariants} from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContentProps,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {Separator} from './separator'
import {SizableText} from './text'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

export type MenuItemType = {
  key: string
  label: string
  subLabel?: string
  icon: React.ReactNode
  onClick: ButtonProps['onClick']
  color?: string
}

export function OptionsDropdown({
  menuItems,
  hiddenUntilItemHover,
  side,
  align,
  className,
}: {
  menuItems: (MenuItemType | null)[]
  hiddenUntilItemHover?: boolean
  hover?: boolean
  button?: JSX.Element
  side?: DropdownMenuContentProps['side']
  align?: DropdownMenuContentProps['align']
  className?: string
}) {
  const popoverState = usePopoverState()
  return (
    <div
      className={cn(
        'flex group-hover/item:opacity-100',
        !popoverState.open && hiddenUntilItemHover
          ? 'opacity-0'
          : 'opacity-100',
        className,
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({size: 'icon', variant: 'ghost'}),
            'no-window-drag',
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="p-1" side={side} align={align}>
          <div className="flex flex-col">
            {menuItems.flatMap((item, index) =>
              item
                ? [
                    index > 0 ? (
                      <Separator key={`${item.key}-separator`} />
                    ) : null,
                    <div key={item.key}>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          popoverState.onOpenChange(false)
                          item.onClick?.(e as any)
                        }}
                      >
                        {item.icon}
                        {item.subLabel ? (
                          <div className="flex flex-col gap-1">
                            <SizableText>{item.label}</SizableText>

                            <SizableText
                              size="sm"
                              className="text-muted-foreground text-xs"
                            >
                              {item.subLabel}
                            </SizableText>
                          </div>
                        ) : (
                          <SizableText>{item.label}</SizableText>
                        )}
                      </DropdownMenuItem>
                    </div>,
                  ]
                : [],
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
