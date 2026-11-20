import type {Meta, StoryObj} from '@storybook/react'

import {Tooltip, TooltipProvider} from './tooltip'

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  args: {content: 'Tooltip text', children: 'Hover me'},
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {content: 'Tooltip text', children: 'Hover me'},
  render: (args: any) => (
    <TooltipProvider>
      <Tooltip {...args} />
    </TooltipProvider>
  ),
}
