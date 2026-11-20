import type {Meta, StoryObj} from '@storybook/react'

import {SettingsRow, SettingsSection} from './settings-list'

const meta = {
  title: 'Components/SettingsRow',
  component: SettingsRow,
  tags: ['autodocs'],
  args: {
    icon: <div className="bg-primary size-4 rounded-sm" />,
    label: 'Notifications',
    description: 'Receive email notifications',
    action: <span className="text-muted-foreground text-xs">Enabled</span>,
  },
} satisfies Meta<typeof SettingsRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    icon: <div className="bg-primary size-4 rounded-sm" />,
    label: 'Notifications',
    description: 'Receive email notifications',
    action: <span className="text-muted-foreground text-xs">Enabled</span>,
  },
}
export const Section: Story = {
  args: {},
  render: () => (
    <SettingsSection label="ACCOUNT">
      <SettingsRow
        icon={<div className="bg-primary size-4 rounded-sm" />}
        label="Email"
        description="user@example.com"
      />
    </SettingsSection>
  ),
}
