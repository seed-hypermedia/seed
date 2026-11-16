import type {Meta, StoryObj} from '@storybook/react'
import {SpaceSettingsIdentity} from './space-settings-identity'
import {StoryProviders, storyDocument, storyId} from './story-fixtures'

const meta = {
  title: 'Pages/SpaceSettingsIdentity',
  component: SpaceSettingsIdentity,
  tags: ['autodocs'],
  args: {
    siteId: storyId,
    metadata: {name: 'Project notes'},
    updateHome: {mutateAsync: async () => {}, isPending: false},
    uploadImage: async () => 'ipfs://fixture',
    onDirtyChange: () => {},
  },
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
} satisfies Meta<typeof SpaceSettingsIdentity>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Saving: Story = {args: {updateHome: {mutateAsync: async () => {}, isPending: true}}}
export const Unnamed: Story = {args: {metadata: {...storyDocument.metadata, name: ''}}}
