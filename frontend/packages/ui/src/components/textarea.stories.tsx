import type {Meta, StoryObj} from '@storybook/react'

import {Textarea} from './textarea'

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: {placeholder: 'Type here…'},
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {placeholder: 'Type here…'},
}
