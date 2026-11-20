import type {Meta, StoryObj} from '@storybook/react'
import {RawDagJsonView, AttachSchemaBar} from './blob-editor-parts'
const meta = {
  title: 'Components/BlobEditorParts',
  component: RawDagJsonView,
  tags: ['autodocs'],
  args: {value: {name: 'Project notes', tags: ['design', 'review']}},
} satisfies Meta<typeof RawDagJsonView>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Empty: Story = {args: {value: {}}}
export const AttachSchema: Story = {render: () => <AttachSchemaBar onAttach={() => {}} onCancel={() => {}} />}
export const ReplaceSchemaWarning: Story = {
  render: () => <AttachSchemaBar replacesUserData onAttach={() => {}} onCancel={() => {}} />,
}
