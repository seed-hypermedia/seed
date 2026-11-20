import type {Meta, StoryObj} from '@storybook/react'

import {Checkbox} from './checkbox'

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: {defaultChecked: true},
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {defaultChecked: true},
}
export const Unchecked: Story = {
  args: {defaultChecked: false},
}

export const Destructive: Story = {
  args: {defaultChecked: true, variant: 'destructive'},
}
