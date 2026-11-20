import type {Meta, StoryObj} from '@storybook/react'

import {Button} from './button'

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: {children: 'Button'},
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: 'Button'},
}
export const Secondary: Story = {
  args: {children: 'Secondary', variant: 'secondary'},
}

export const Outline: Story = {
  args: {children: 'Outline', variant: 'outline'},
}

export const Ghost: Story = {
  args: {children: 'Ghost', variant: 'ghost'},
}

export const Destructive: Story = {
  args: {children: 'Destructive', variant: 'destructive'},
}

export const Loading: Story = {
  args: {children: 'Loading', loading: true},
}
