import {HelpCircle, MoreHorizontal} from 'lucide-react'
import {useRef, useState} from 'react'
import {ButtonProps, buttonVariants} from './button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContentProps,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

const TOOLTIP_MAX_WIDTH = 320
const TOOLTIP_VIEWPORT_PADDING = 16

// Renders a question mark icon with a hover tooltip.
// Picks right vs top based on actual viewport room at hover time.
function MenuItemHelpIcon({content}: {content: string}) {
  const [side, setSide] = useState<'right' | 'top'>('right')
  const ref = useRef<HTMLSpanElement>(null)
  const measure = () => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const fitsRight = rect.right + TOOLTIP_MAX_WIDTH + TOOLTIP_VIEWPORT_PADDING < window.innerWidth
    setSide(fitsRight ? 'right' : 'top')
  }
  return (
    <Tooltip content={content} side={side} delay={150} asChild>
      <span
        ref={ref}
        onMouseEnter={measure}
        onFocus={measure}
        className="text-muted-foreground ml-auto inline-flex"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
      >
        <HelpCircle className="size-3.5" />
      </span>
    </Tooltip>
  )
}

export type MenuItemType = {
  key: string
  label: string
  subLabel?: string
  icon: React.ReactNode
  onClick?: ButtonProps['onClick']
  variant?: 'default' | 'destructive'
  children?: MenuItemType[]
  tooltip?: string
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
                  {item.children ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        {item.icon}
                        <SizableText>{item.label}</SizableText>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {item.children.map((child) => (
                          <DropdownMenuItem
                            key={child.key}
                            variant={child.variant}
                            onClick={(e) => {
                              e.stopPropagation()
                              popoverState.onOpenChange(false)
                              child.onClick?.(e as any)
                            }}
                          >
                            {child.icon}
                            <SizableText>{child.label}</SizableText>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : (
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
                  {item.tooltip ? <MenuItemHelpIcon content={item.tooltip} /> : null}
                </DropdownMenuItem>
              )}
                </div>
              ))
            })()}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
