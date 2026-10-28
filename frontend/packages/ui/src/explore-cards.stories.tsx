import type {Meta, StoryObj} from '@storybook/react'
import {ExplorePersonCard} from './explore-cards'
import {StoryProviders, storyId} from './story-fixtures'
const meta = {
  title: 'Components/ExploreCards',
  component: ExplorePersonCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {account: {uid: storyId.uid, name: 'Ada Lovelace', role: 'owner'}},
} satisfies Meta<typeof ExplorePersonCard>
export default meta
type Story = StoryObj<typeof meta>
export const Person: Story = {}
export const Unnamed: Story = {args: {account: {uid: storyId.uid}}}
