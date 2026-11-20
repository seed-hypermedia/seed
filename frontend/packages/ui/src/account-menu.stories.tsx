import type {Meta, StoryObj} from '@storybook/react'
import {AccountAvatar} from './account-avatar'
import {
  AccountMenuIdentity,
  AccountMenuScrollArea,
  AccountMenuSection,
  AccountMenuSwitcher,
  accountMenuContentClassName,
} from './account-menu'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {StoryProviders, storyId} from './story-fixtures'

const meta = {
  title: 'Components/AccountMenu',
  component: AccountMenuIdentity,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <div className="p-6">
          <Story />
        </div>
      </StoryProviders>
    ),
  ],
  args: {
    avatar: <AccountAvatar id={storyId} name="Ada Lovelace" />,
    name: 'Ada Lovelace',
    role: 'Administrator',
    email: 'ada@example.test',
  },
} satisfies Meta<typeof AccountMenuIdentity>

export default meta
type Story = StoryObj<typeof meta>

export const Identity: Story = {}

export const AccountList: Story = {
  render: () => (
    <div className="bg-popover w-80 rounded-xl border shadow-lg">
      <AccountMenuSection>Accounts</AccountMenuSection>
      <AccountMenuScrollArea>
        {['Ada Lovelace', 'Grace Hopper', 'Katherine Johnson', 'Margaret Hamilton'].map((name) => (
          <div key={name} className="flex items-center gap-3 px-4 py-3">
            <AccountAvatar id={storyId} name={name} />
            <span className="truncate text-sm font-medium">{name}</span>
          </div>
        ))}
      </AccountMenuScrollArea>
    </div>
  ),
}

export const AccountSwitcher: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button className="rounded-md border px-3 py-2 text-sm">Open account menu</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={accountMenuContentClassName}>
        <AccountMenuSection>Settings</AccountMenuSection>
        <DropdownMenuItem>Account settings</DropdownMenuItem>
        <AccountMenuSection>Switch account</AccountMenuSection>
        <AccountMenuSwitcher
          identity={
            <AccountMenuIdentity avatar={<AccountAvatar id={storyId} name="Ada Lovelace" />} name="Ada Lovelace" />
          }
        >
          <DropdownMenuItem>
            <AccountAvatar id={storyId} name="Grace Hopper" />
            <span>Grace Hopper</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <AccountAvatar id={storyId} name="Katherine Johnson" />
            <span>Katherine Johnson</span>
          </DropdownMenuItem>
        </AccountMenuSwitcher>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
