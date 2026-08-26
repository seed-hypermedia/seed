import type {Meta, StoryObj} from '@storybook/react'

import {PrivateBadge} from './private-badge'

const meta = {
  title: 'Components/PrivateBadge',
  component: PrivateBadge,
  tags: ['autodocs'],
  args: {size: 'md'},
} satisfies Meta<typeof PrivateBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {size: 'md'},
}
