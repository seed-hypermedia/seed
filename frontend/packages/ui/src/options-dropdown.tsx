import {Button} from '@tamagui/button'
import {MoreHorizontal} from '@tamagui/lucide-icons'
import {GestureReponderEvent} from '@tamagui/web'
import {FC} from 'react'
import {GestureResponderEvent} from 'react-native'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuContentProps,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {MenuItem} from './menu-item'
import {Separator} from './separator'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

export type MenuItemType = {
  key: string
  label: string
  subLabel?: string
  icon: FC
  onPress: () => void
  color?: string
}

export function OptionsDropdown({
  menuItems,
  hiddenUntilItemHover,
  button,
  side,
  align,
}: {
  menuItems: (MenuItemType | null)[]
  hiddenUntilItemHover?: boolean
  hover?: boolean
  button?: JSX.Element
  side?: DropdownMenuContentProps['side']
  align?: DropdownMenuContentProps['align']
}) {
  const popoverState = usePopoverState()
  return (
    <div
      className={cn(
        'flex group-hover/item:opacity-100',
        !popoverState.open && hiddenUntilItemHover
          ? 'opacity-0'
          : 'opacity-100',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger>
          {button || (
            <Button
              size="$1"
              chromeless
              hoverStyle={{
                bg: '$color6',
              }}
              circular
              data-trigger
              onPress={(e: GestureReponderEvent) => {
                // because we are nested in the outer button, we need to stop propagation or else onPress is triggered by parent button
                e.stopPropagation()
              }}
              icon={MoreHorizontal}
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="p-0" side={side} align={align}>
          <div className="flex flex-col">
            {menuItems.flatMap((item, index) =>
              item
                ? [
                    index > 0 ? (
                      <Separator key={`${item.key}-separator`} />
                    ) : null,
                    <div key={item.key}>
                      <MenuItem
                        onPress={(e: GestureResponderEvent) => {
                          e.stopPropagation()
                          popoverState.onOpenChange(false)
                          item.onPress()
                        }}
                        subTitle={item.subLabel}
                        title={item.label}
                        icon={item.icon}
                        color={item.color}
                      />
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
