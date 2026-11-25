import type {Meta, StoryObj} from '@storybook/react'

import {DeleteAccountDialog} from './delete-account-dialog'

const meta = {
  title: 'Components/DeleteAccountDialog',
  component: DeleteAccountDialog,
  tags: ['autodocs'],
  args: {open: true, onOpenChange: () => {}, accountName: 'Alice', onDelete: async () => {}, busy: false},
} satisfies Meta<typeof DeleteAccountDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {open: true, onOpenChange: () => {}, accountName: 'Alice', onDelete: async () => {}, busy: false},
}
