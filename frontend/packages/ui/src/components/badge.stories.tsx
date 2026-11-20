import type {Meta, StoryObj} from '@storybook/react'

import {Badge} from './badge'

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: {
    children: 'Badge',
    variant: 'default',
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Secondary: Story = {
  args: {variant: 'secondary'},
}

export const Accent: Story = {
  args: {variant: 'accent'},
}

export const Destructive: Story = {
  args: {variant: 'destructive'},
}

export const Outline: Story = {
  args: {variant: 'outline'},
}

export const Warning: Story = {
  args: {variant: 'warning'},
}
