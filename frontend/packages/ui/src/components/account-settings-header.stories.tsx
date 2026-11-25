import type {Meta, StoryObj} from '@storybook/react'

import {AccountSettingsHeader} from './account-settings-header'

const meta = {
  title: 'Components/AccountSettingsHeader',
  component: AccountSettingsHeader,
  tags: ['autodocs'],
  args: {activeTab: 'devices', onTabChange: () => {}, onOpenProfile: () => {}},
} satisfies Meta<typeof AccountSettingsHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {activeTab: 'devices', onTabChange: () => {}, onOpenProfile: () => {}},
}
