import type {Meta, StoryObj} from '@storybook/react'

import {SetPasswordDialog} from './set-password-dialog'

const meta = {
  title: 'Components/SetPasswordDialog',
  component: SetPasswordDialog,
  tags: ['autodocs'],
  args: {open: true, onOpenChange: () => {}, mode: 'set', onSubmit: async () => {}},
} satisfies Meta<typeof SetPasswordDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {open: true, onOpenChange: () => {}, mode: 'set', onSubmit: async () => {}},
}
