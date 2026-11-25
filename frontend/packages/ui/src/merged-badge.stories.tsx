import type {Meta, StoryObj} from '@storybook/react'

import {MergedBadge} from './merged-badge'

const meta = {
  title: 'Components/MergedBadge',
  component: MergedBadge,
  tags: ['autodocs'],
  args: {count: 3},
} satisfies Meta<typeof MergedBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {count: 3},
}
