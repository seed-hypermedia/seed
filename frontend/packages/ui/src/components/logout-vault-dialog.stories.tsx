import type {Meta, StoryObj} from '@storybook/react'

import {LogoutVaultDialog} from './logout-vault-dialog'

const meta = {
  title: 'Components/LogoutVaultDialog',
  component: LogoutVaultDialog,
  tags: ['autodocs'],
  args: {open: true, onOpenChange: () => {}, onLogOut: () => {}, busy: false},
} satisfies Meta<typeof LogoutVaultDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {open: true, onOpenChange: () => {}, onLogOut: () => {}, busy: false},
}
