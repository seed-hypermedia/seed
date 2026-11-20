import type {Meta, StoryObj} from '@storybook/react'

import {Text} from './text'

const meta = {
  title: 'Components/Text',
  component: Text,
  tags: ['autodocs'],
  args: {children: 'The quick brown fox jumps over the lazy dog.'},
} satisfies Meta<typeof Text>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: 'The quick brown fox jumps over the lazy dog.'},
}
export const Muted: Story = {
  args: {children: 'Muted text', color: 'muted'},
}

export const Large: Story = {
  args: {children: 'Large text', size: 'lg'},
}
