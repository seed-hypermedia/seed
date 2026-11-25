import type {Meta, StoryObj} from '@storybook/react'

import {Input} from './input'

const meta = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  args: {placeholder: 'Type here…'},
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {placeholder: 'Type here…'},
}
export const Unstyled: Story = {
  args: {placeholder: 'Unstyled input', variant: 'unstyled'},
}
