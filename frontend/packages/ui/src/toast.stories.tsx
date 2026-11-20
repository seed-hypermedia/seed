import type {Meta, StoryObj} from '@storybook/react'

import {Toaster} from './toast'

const meta = {
  title: 'Components/Toaster',
  component: Toaster,
  tags: ['autodocs'],
  args: {},
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Toaster />,
}
