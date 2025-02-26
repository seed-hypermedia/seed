import {BlockSchema} from '@/blocknote/core'
import {createStyles, Menu} from '@mantine/core'
import {LinkMenuItem} from './LinkMenuItem'
import {LinkMenuProps} from './LinkMenuPositioner'

export function DefaultLinkMenu<BSchema extends BlockSchema>(
  props: LinkMenuProps<BSchema>,
) {
  const {classes} = createStyles({root: {}})(undefined, {
    name: 'LinkMenu',
  })
  const renderedItems: any[] = []

  if (props.items.length > 1) {
    renderedItems.push(
      <Menu.Label key="list-label" style={{fontWeight: 'bold', fontSize: 14}}>
        Insert as:
      </Menu.Label>,
    )
  }
  let index = 0

  for (const item of props.items) {
    renderedItems.push(
      <LinkMenuItem
        key={item.key}
        name={item.name}
        icon={item.icon}
        hint={item.hint}
        disabled={item.disabled}
        isSelected={props.keyboardHoveredItemIndex === index}
        set={() => props.itemCallback(item, '')}
      />,
    )
    index++
  }

  return (
    <Menu
      /** Hacky fix to get the desired menu behaviour. The trigger="hover"
       * attribute allows focus to remain on the editor, allowing for suggestion
       * filtering. The closeDelay=10000000 attribute allows the menu to stay open
       * practically indefinitely, as normally hovering off it would cause it to
       * close due to trigger="hover".
       */
      defaultOpened={true}
      trigger={'hover'}
      closeDelay={10000000}
    >
      <Menu.Dropdown
        // TODO: This should go back in the plugin.
        onMouseDown={(event) => event.preventDefault()}
        className={classes.root}
      >
        {renderedItems.length > 0 ? (
          renderedItems
        ) : (
          <Menu.Item>No match found</Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
