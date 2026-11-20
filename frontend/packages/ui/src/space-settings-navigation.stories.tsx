import type {Meta, StoryObj} from '@storybook/react'
import {SpaceSettingsNavigation} from './space-settings-navigation'
import {StoryProviders, storyDocument, storyId} from './story-fixtures'

const meta = {
  title: 'Pages/SpaceSettingsNavigation',
  component: SpaceSettingsNavigation,
  tags: ['autodocs'],
  args: {
    siteId: storyId,
    document: storyDocument,
    updateHome: {mutateAsync: async () => {}, isPending: false},
    onDirtyChange: () => {},
  },
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
} satisfies Meta<typeof SpaceSettingsNavigation>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const WideWithoutOutline: Story = {
  args: {document: {...storyDocument, metadata: {...storyDocument.metadata, contentWidth: 'L', showOutline: false}}},
}
