import {MoreHorizontal} from 'lucide-react'
import {ButtonProps, buttonVariants} from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContentProps,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {SizableText} from './text'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

export type MenuItemType = {
  key: string
  label: string
  subLabel?: string
  icon: React.ReactNode
  onClick: ButtonProps['onClick']
  variant?: 'default' | 'destructive'
}

export function OptionsDropdown({
  menuItems,
  hiddenUntilItemHover,
  side,
  align,
  className,
  size = 'icon',
}: {
  menuItems: (MenuItemType | null)[]
  hiddenUntilItemHover?: boolean
  hover?: boolean
  button?: JSX.Element
  side?: DropdownMenuContentProps['side']
  align?: DropdownMenuContentProps['align']
  size?: ButtonProps['size']
  className?: string
}) {
  const popoverState = usePopoverState()

  return (
    <div
      className={cn(
        'flex group-hover/item:opacity-100',
        !popoverState.open && hiddenUntilItemHover ? 'opacity-0' : 'opacity-100',
        className,
        popoverState.open && '!opacity-100', // Force visible when dropdown is open
      )}
    >
      <DropdownMenu open={popoverState.open} onOpenChange={popoverState.onOpenChange}>
        <DropdownMenuTrigger className={cn(buttonVariants({variant: 'outline', size}), 'no-window-drag')}>
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="p-1" side={side} align={align}>
          <div className="flex flex-col">
            {(() => {
              // Filter items so destructive items are rendered at the bottom of the menu
              const presentItems = menuItems.filter((item): item is MenuItemType => item != null)
              const nonDestructive = presentItems.filter((item) => item.variant !== 'destructive')
              const destructive = presentItems.filter((item) => item.variant === 'destructive')
              const ordered = [...nonDestructive, ...destructive]
              const firstDestructiveIndex =
                nonDestructive.length > 0 && destructive.length > 0 ? nonDestructive.length : -1

              return ordered.map((item, index) => (
                <div key={item.key}>
                  {index === firstDestructiveIndex ? (
                    // Show separator before first destructive item
                    <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
                  ) : null}
                  <DropdownMenuItem
                    variant={item.variant}
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

                        <SizableText size="sm" className="text-muted-foreground text-xs">
                          {item.subLabel}
                        </SizableText>
                      </div>
                    ) : (
                      <SizableText>{item.label}</SizableText>
                    )}
                  </DropdownMenuItem>
                </div>
              ))
            })()}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
