import type {Meta, StoryObj} from '@storybook/react'

import {ChangeEmailDialog} from './change-email-dialog'

const meta = {
  title: 'Components/ChangeEmailDialog',
  component: ChangeEmailDialog,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    currentEmail: 'old@example.com',
    onStart: async () => ({expireTimeMs: 60000}),
    onVerify: async () => {},
  },
} satisfies Meta<typeof ChangeEmailDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    currentEmail: 'old@example.com',
    onStart: async () => ({expireTimeMs: 60000}),
    onVerify: async () => {},
  },
}
