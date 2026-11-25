import type {Meta, StoryObj} from '@storybook/react'
import {ActivityEventCard} from './activity-event-card'
import {StoryProviders, storyId, storyDocument} from './story-fixtures'
const meta = {
  title: 'Components/ActivityEventCard',
  component: ActivityEventCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {
    route: null,
    event: {
      id: 'event',
      type: 'doc-update',
      docId: storyId,
      author: {id: storyId, metadata: {name: 'Ada'}},
      time: {seconds: 1792490400, nanos: 0},
      document: storyDocument,
    },
  },
} satisfies Meta<typeof ActivityEventCard>
export default meta
type Story = StoryObj<typeof meta>
export const Created: Story = {}
export const Updated: Story = {args: {event: {...meta.args.event, document: {...storyDocument, version: 'updated'}}}}
