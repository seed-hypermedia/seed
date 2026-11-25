import type {Meta, StoryObj} from '@storybook/react'
import {ContentEmbed} from './content-embed'
import {StoryProviders, storyBlocks, storyId} from './story-fixtures'
const meta = {
  title: 'Components/ContentEmbed',
  component: ContentEmbed,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {id: storyId, blocks: storyBlocks, title: 'Project notes', openOnClick: false},
} satisfies Meta<typeof ContentEmbed>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Empty: Story = {args: {blocks: []}}
export const WithIdentity: Story = {args: {identity: {id: storyId, name: 'Ada Lovelace'}}}
