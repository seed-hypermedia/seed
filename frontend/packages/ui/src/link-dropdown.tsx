import {NavRoute, useRouteLink} from '@shm/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {Button} from '@tamagui/button'
import {MoreHorizontal} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
import {ComponentProps} from 'react'
import {PopoverProps} from 'tamagui'
import {MenuItem} from './menu-item'
import {DocNavigationItem} from './navigation'

export function LinkDropdown({
  items,
  button,
}: {
  items: (DocNavigationItem | null)[]
  hover?: boolean
  button?: JSX.Element
  placement?: PopoverProps['placement']
}) {
  // const popoverState = usePopoverState()
  return (
    <XStack
    // opacity={!popoverState.open && hiddenUntilItemHover ? 0 : 1}
    // $group-item-hover={{
    //   opacity: 1,
    // }}
    >
      <Popover
      //{...popoverState}
      >
        <PopoverTrigger>
          {button || (
            <Button
              size="$1"
              chromeless
              hoverStyle={{
                bg: '$color6',
              }}
              circular
              icon={MoreHorizontal}
            />
          )}
        </PopoverTrigger>
        <PopoverContent className="max-h-[300px] overflow-y-scroll p-0">
          {/* <span>hello {items.length}</span> */}
          {items.map(
            (item, index) =>
              item && (
                <div key={item.key}>
                  {/* <RouteLinkButton */}

                  <RouteLinkButton
                    route={
                      item.draftId
                        ? {key: 'draft', id: item.draftId}
                        : item.id
                        ? {key: 'document', id: item.id}
                        : item.webUrl || ''
                    }
                    title={item.metadata.name}
                    // icon={item.icon}
                    // color={item.color}
                  />
                </div>
              ),
          )}
        </PopoverContent>
      </Popover>
    </XStack>
  )
}

function RouteLinkButton({
  route,
  ...menuItemProps
}: {route: NavRoute | string} & ComponentProps<typeof MenuItem>) {
  const linkProps = useRouteLink(route)
  return <MenuItem {...menuItemProps} {...linkProps} />
}
