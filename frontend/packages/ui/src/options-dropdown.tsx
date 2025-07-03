import {Button} from '@tamagui/button'
import {MoreHorizontal} from '@tamagui/lucide-icons'
import {GestureReponderEvent} from '@tamagui/web'
import {FC} from 'react'
import {GestureResponderEvent} from 'react-native'
import {PopoverProps} from 'tamagui'
import {MenuItem} from './menu-item'
import {Separator} from './separator'
import {Popover} from './TamaguiPopover'
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
  placement = 'bottom-end',
}: {
  menuItems: (MenuItemType | null)[]
  hiddenUntilItemHover?: boolean
  hover?: boolean
  button?: JSX.Element
  placement?: PopoverProps['placement']
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
      <Popover {...popoverState} placement={placement}>
        <Popover.Trigger asChild>
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
        </Popover.Trigger>
        <Popover.Content
          padding={0}
          elevation="$2"
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
          elevate={true}
        >
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
        </Popover.Content>
      </Popover>
    </div>
  )
}
