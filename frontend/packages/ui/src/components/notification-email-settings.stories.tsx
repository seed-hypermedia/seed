import type {Meta, StoryObj} from '@storybook/react'

import {NotificationEmailSettings} from './notification-email-settings'

const meta = {
  title: 'Components/NotificationEmailSettings',
  component: NotificationEmailSettings,
  tags: ['autodocs'],
  args: {
    email: 'user@example.com',
    needsVerification: false,
    onSetEmail: () => {},
    onRemoveEmail: () => {},
    onResendVerification: () => {},
  },
} satisfies Meta<typeof NotificationEmailSettings>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    email: 'user@example.com',
    needsVerification: false,
    onSetEmail: () => {},
    onRemoveEmail: () => {},
    onResendVerification: () => {},
  },
}
export const Unverified: Story = {
  args: {
    email: 'user@example.com',
    needsVerification: true,
    onSetEmail: () => {},
    onRemoveEmail: () => {},
    onResendVerification: () => {},
  },
}
