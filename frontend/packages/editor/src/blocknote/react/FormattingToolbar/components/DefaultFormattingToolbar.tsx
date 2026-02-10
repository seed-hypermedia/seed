import {BlockSchema} from '../../../core'

import {Toolbar} from '../../SharedComponents/Toolbar/components/Toolbar'
import {ToggledStyleButton} from './DefaultButtons/ToggledStyleButton'
import {
  BlockTypeDropdown,
  BlockTypeDropdownItem,
} from './DefaultDropdowns/BlockTypeDropdown'
import {FormattingToolbarProps} from './FormattingToolbarPositioner'
import {CreateLinkButton} from './DefaultButtons/CreateLinkButton'
import {
  NestBlockButton,
  UnnestBlockButton,
} from './DefaultButtons/NestBlockButtons'

export const DefaultFormattingToolbar = <BSchema extends BlockSchema>(
  props: FormattingToolbarProps<BSchema> & {
    blockTypeDropdownItems?: BlockTypeDropdownItem[]
  },
) => {
  return (
    <Toolbar>
      <BlockTypeDropdown {...props} items={props.blockTypeDropdownItems} />

      <ToggledStyleButton editor={props.editor} toggledStyle={'bold'} />
      <ToggledStyleButton editor={props.editor} toggledStyle={'italic'} />
      <ToggledStyleButton editor={props.editor} toggledStyle={'underline'} />
      <ToggledStyleButton editor={props.editor} toggledStyle={'strike'} />
      <ToggledStyleButton editor={props.editor} toggledStyle={'code'} />

      <NestBlockButton editor={props.editor} />
      <UnnestBlockButton editor={props.editor} />

      <CreateLinkButton editor={props.editor} />
    </Toolbar>
  )
}
