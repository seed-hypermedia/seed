import type {Meta, StoryObj} from '@storybook/react'

import {Spinner} from './spinner'

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  args: {size: 'large'},
} satisfies Meta<typeof Spinner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {size: 'large'},
}
