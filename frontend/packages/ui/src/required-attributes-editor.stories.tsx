import type {Meta, StoryObj} from '@storybook/react'
import {RequiredAttributesEditor} from './required-attributes-editor'
import {HM_SCHEMAS} from './schema/engine'
import {metadataSchemaOf} from './schema/schema-resolve'
import {StoryProviders} from './story-fixtures'
const meta = {
  title: 'Components/RequiredAttributesEditor',
  component: RequiredAttributesEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {
    conformanceSchema: metadataSchemaOf(HM_SCHEMAS['example/person-doc']),
    metadata: {name: 'Ada', surname: 'Lovelace'},
  },
} satisfies Meta<typeof RequiredAttributesEditor>
export default meta
type Story = StoryObj<typeof meta>
export const ReadOnly: Story = {}
export const MissingValue: Story = {args: {metadata: {name: 'Ada'}}}
export const NoSchema: Story = {args: {conformanceSchema: undefined}}
