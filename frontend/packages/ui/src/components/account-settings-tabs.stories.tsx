import type {Meta, StoryObj} from '@storybook/react'

import {AccountSettingsTabs} from './account-settings-tabs'

const meta = {
  title: 'Components/AccountSettingsTabs',
  component: AccountSettingsTabs,
  tags: ['autodocs'],
  args: {activeTab: 'devices', onTabChange: () => {}},
} satisfies Meta<typeof AccountSettingsTabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {activeTab: 'devices', onTabChange: () => {}},
}
