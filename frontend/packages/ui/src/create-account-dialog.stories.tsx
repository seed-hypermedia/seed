import type {Meta, StoryObj} from '@storybook/react'

import {Dialog, DialogContent} from './components/dialog'
import {CreateAccountDialogContent} from './create-account-dialog'

const meta = {
  title: 'Components/CreateAccountDialogContent',
  component: CreateAccountDialogContent,
  tags: ['autodocs'],
  args: {
    title: 'Create Account',
    localAccountTitle: 'Local Identity',
    localAccountDescription: 'Create a new identity on this device.',
    onSubmit: () => {},
  },
} satisfies Meta<typeof CreateAccountDialogContent>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'Create Account',
    localAccountTitle: 'Local Identity',
    localAccountDescription: 'Create a new identity on this device.',
    onSubmit: () => {},
  },
  render: (args: any) => (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-md">
        <CreateAccountDialogContent {...args} />
      </DialogContent>
    </Dialog>
  ),
}
