import {NavRoute, useRouteLink} from '@shm/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {MoreHorizontal} from 'lucide-react'
import {ComponentProps} from 'react'
import {Button} from './button'
import {MenuItem} from './menu-item'
import {DocNavigationItem} from './navigation'

export function LinkDropdown({
  items,
  button,
}: {
  items: (DocNavigationItem | null)[]
  hover?: boolean
  button?: JSX.Element
  placement?: any
}) {
  // const popoverState = usePopoverState()
  return (
    <div className="flex">
      <Popover
      //{...popoverState}
      >
        <PopoverTrigger>
          {button || (
            <Button size="sm" variant="ghost" className="rounded-full">
              <MoreHorizontal className="size-3" />
            </Button>
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
    </div>
  )
}

function RouteLinkButton({
  route,
  ...menuItemProps
}: {route: NavRoute | string} & ComponentProps<typeof MenuItem>) {
  const linkProps = useRouteLink(route)
  return <MenuItem {...menuItemProps} {...linkProps} />
}
