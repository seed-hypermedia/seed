import {NavRoute, useRouteLink} from '@shm/shared'
import {Button} from '@tamagui/button'
import {YGroup} from '@tamagui/group'
import {MoreHorizontal} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
import {GestureReponderEvent} from '@tamagui/web'
import {ComponentProps, FC} from 'react'
import {PopoverProps, Separator} from 'tamagui'
import {MenuItem} from './menu-item'
import {Popover} from './TamaguiPopover'
import {usePopoverState} from './use-popover-state'

export type LinkItemType = {
  key: string
  label: string
  subLabel?: string
  icon: FC
  route: NavRoute
  color?: string
}

export function LinkDropdown({
  items,
  hiddenUntilItemHover,
  button,
  placement = 'bottom-end',
}: {
  items: (LinkItemType | null)[]
  hiddenUntilItemHover?: boolean
  hover?: boolean
  button?: JSX.Element
  placement?: PopoverProps['placement']
}) {
  const popoverState = usePopoverState()
  return (
    <XStack
      opacity={!popoverState.open && hiddenUntilItemHover ? 0 : 1}
      $group-item-hover={{
        opacity: 1,
      }}
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
          <YGroup>
            {items.flatMap((item, index) =>
              item
                ? [
                    index > 0 ? (
                      <Separator
                        key={`${item.key}-separator`}
                        borderColor="$color7"
                      />
                    ) : null,
                    <YGroup.Item key={item.key}>
                      {/* <RouteLinkButton */}

                      <RouteLinkButton
                        route={item.route}
                        subTitle={item.subLabel}
                        title={item.label}
                        icon={item.icon}
                        color={item.color}
                      />
                    </YGroup.Item>,
                  ]
                : [],
            )}
          </YGroup>
        </Popover.Content>
      </Popover>
    </XStack>
  )
}

function RouteLinkButton({
  route,
  ...menuItemProps
}: {route: NavRoute} & ComponentProps<typeof MenuItem>) {
  const linkProps = useRouteLink(route)
  return <MenuItem {...menuItemProps} {...linkProps} />
}
