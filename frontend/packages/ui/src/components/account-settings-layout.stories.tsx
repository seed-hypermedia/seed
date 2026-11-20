import type {Meta, StoryObj} from '@storybook/react'

import {AccountSettingsLayout} from './account-settings-layout'

const meta = {
  title: 'Components/AccountSettingsLayout',
  component: AccountSettingsLayout,
  tags: ['autodocs'],
  args: {
    accounts: [],
    selectedAccountId: null,
    isVaultSelected: false,
    onSelectVault: () => {},
    onSelectAccount: () => {},
    children: <div className="p-4">Detail pane</div>,
  },
} satisfies Meta<typeof AccountSettingsLayout>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    accounts: [],
    selectedAccountId: null,
    isVaultSelected: false,
    onSelectVault: () => {},
    onSelectAccount: () => {},
    children: <div className="p-4">Detail pane</div>,
  },
}
