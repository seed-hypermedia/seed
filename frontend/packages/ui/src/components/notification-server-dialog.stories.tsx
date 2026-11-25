import type {Meta, StoryObj} from '@storybook/react'

import {NotificationServerDialog} from './notification-server-dialog'

const meta = {
  title: 'Components/NotificationServerDialog',
  component: NotificationServerDialog,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    currentUrl: '',
    defaultUrl: 'https://notify.example.com',
    onSave: async () => {},
  },
} satisfies Meta<typeof NotificationServerDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    currentUrl: '',
    defaultUrl: 'https://notify.example.com',
    onSave: async () => {},
  },
}
