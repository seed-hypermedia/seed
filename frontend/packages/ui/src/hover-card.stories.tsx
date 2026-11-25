import type {Meta, StoryObj} from '@storybook/react'

import {HoverCard, HoverCardContent, HoverCardTrigger} from './hover-card'

const meta = {
  title: 'Components/HoverCard',
  component: HoverCard,
  tags: ['autodocs'],
  args: {defaultOpen: true},
} satisfies Meta<typeof HoverCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {defaultOpen: true},
  render: (args: any) => (
    <HoverCard {...args}>
      <HoverCardTrigger className="text-sm underline">Hover me</HoverCardTrigger>
      <HoverCardContent>
        <p className="text-sm">Hover card content</p>
      </HoverCardContent>
    </HoverCard>
  ),
}
