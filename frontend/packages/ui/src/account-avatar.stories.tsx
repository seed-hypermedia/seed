import type {Meta, StoryObj} from '@storybook/react'
import {AccountAvatar, AccountIdentity} from './account-avatar'
import {StoryProviders, storyId} from './story-fixtures'
const meta = {
  title: 'Components/AccountAvatar',
  component: AccountAvatar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {id: storyId, name: 'Ada Lovelace'},
} satisfies Meta<typeof AccountAvatar>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Unnamed: Story = {args: {name: undefined}}
export const IdentityLoading: Story = {render: () => <AccountIdentity id={storyId} name="Ada Lovelace" loading />}
