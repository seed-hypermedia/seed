import type {Meta, StoryObj} from '@storybook/react'

import {Separator} from './separator'

const meta = {
  title: 'Components/Separator',
  component: Separator,
  tags: ['autodocs'],
  args: {className: 'my-4'},
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {className: 'my-4'},
}
