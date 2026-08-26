import type {Meta, StoryObj} from '@storybook/react'

import {DraftBadge} from './draft-badge'

const meta = {
  title: 'Components/DraftBadge',
  component: DraftBadge,
  tags: ['autodocs'],
  args: {},
} satisfies Meta<typeof DraftBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}
