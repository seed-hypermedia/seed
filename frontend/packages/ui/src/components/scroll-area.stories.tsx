import type {Meta, StoryObj} from '@storybook/react'

import {ScrollArea} from './scroll-area'

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
  tags: ['autodocs'],
  args: {className: 'h-32 w-48 rounded-md border p-4'},
} satisfies Meta<typeof ScrollArea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {className: 'h-32 w-48 rounded-md border p-4'},
  render: (args: any) => (
    <ScrollArea {...args}>
      <div className="h-64">
        Long content that scrolls inside the viewport. Repeated text to create overflow. Long content that scrolls
        inside the viewport.
      </div>
    </ScrollArea>
  ),
}
