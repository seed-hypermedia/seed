import type {Meta, StoryObj} from '@storybook/react'

import {UIAvatar} from './avatar'

const meta = {
  title: 'Components/UIAvatar',
  component: UIAvatar,
  tags: ['autodocs'],
  args: {id: 'alice', size: 40, label: 'Alice'},
} satisfies Meta<typeof UIAvatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {id: 'alice', size: 40, label: 'Alice'},
}
