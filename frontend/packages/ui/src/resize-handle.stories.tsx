import type {Meta, StoryObj} from '@storybook/react'

import {ResizeHandle} from './resize-handle'

const meta = {
  title: 'Components/ResizeHandle',
  component: ResizeHandle,
  tags: ['autodocs'],
  args: {onMouseDown: () => {}},
} satisfies Meta<typeof ResizeHandle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {onMouseDown: () => {}},
}
