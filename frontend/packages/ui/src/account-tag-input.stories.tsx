import type {Meta, StoryObj} from '@storybook/react'
import {AccountTagInput} from './account-tag-input'
import {StoryProviders, storyId} from './story-fixtures'
const meta = {
  title: 'Components/AccountTagInput',
  component: AccountTagInput,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {label: 'Collaborators', defaultValues: []},
} satisfies Meta<typeof AccountTagInput>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Selected: Story = {
  args: {defaultValues: [{id: storyId, label: 'Ada Lovelace', metadata: {name: 'Ada Lovelace'}}]},
}
