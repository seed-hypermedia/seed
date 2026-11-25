import type {Meta, StoryObj} from '@storybook/react'

import {Popover, PopoverContent, PopoverTrigger} from './popover'

const meta = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
  args: {open: true, onOpenChange: () => {}},
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {open: true, onOpenChange: () => {}},
  render: (args: any) => (
    <Popover {...args}>
      <PopoverTrigger className="text-sm underline">Open popover</PopoverTrigger>
      <PopoverContent>
        <p className="text-sm">Popover content</p>
      </PopoverContent>
    </Popover>
  ),
}
