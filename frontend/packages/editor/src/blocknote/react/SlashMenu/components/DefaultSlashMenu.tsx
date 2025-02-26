import {createStyles, Menu} from '@mantine/core'
import * as _ from 'lodash'

import {BlockSchema} from '@/blocknote/core'
import {SlashMenuItem} from './SlashMenuItem'
import {SlashMenuProps} from './SlashMenuPositioner'

export function DefaultSlashMenu<BSchema extends BlockSchema>(
  props: SlashMenuProps<BSchema>,
) {
  const {classes} = createStyles({root: {}})(undefined, {
    name: 'SlashMenu',
  })
  const renderedItems: any[] = []
  let index = 0

  const groups = _.groupBy(props.filteredItems, (i) => i.group)
  // const showNostr = trpc.experiments.get.useQuery().data?.nostr

  _.forEach(groups, (groupedItems) => {
    renderedItems.push(
      <Menu.Label key={groupedItems[0].group}>
        {groupedItems[0].group}
      </Menu.Label>,
    )

    for (const item of groupedItems) {
      // if (item.name !== 'Nostr' || showNostr) {
      renderedItems.push(
        <SlashMenuItem
          key={item.name}
          name={item.name}
          icon={item.icon}
          hint={item.hint}
          shortcut={item.shortcut}
          isSelected={props.keyboardHoveredItemIndex === index}
          set={() => props.itemCallback(item)}
        />,
      )
      // }
      index++
    }
  })

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
