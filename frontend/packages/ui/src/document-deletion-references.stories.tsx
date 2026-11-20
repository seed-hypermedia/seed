import type {Meta, StoryObj} from '@storybook/react'
import {DocumentDeletionReferences} from './document-deletion-references'
import {StoryProviders, storyId, storyClient} from './story-fixtures'
const meta = {
  title: 'Components/DocumentDeletionReferences',
  component: DocumentDeletionReferences,
  tags: ['autodocs'],
  decorators: [
    (Story, context) => (
      <StoryProviders client={context.parameters.fixtureClient}>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {documentIds: [storyId.id]},
} satisfies Meta<typeof DocumentDeletionReferences>
export default meta
type Story = StoryObj<typeof meta>
export const NoReferences: Story = {}
export const Empty: Story = {args: {documentIds: []}}
export const Unavailable: Story = {
  parameters: {
    fixtureClient: {
      ...storyClient,
      request: async () => {
        throw new Error('Offline')
      },
    },
  },
}
