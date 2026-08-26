import type {Meta, StoryObj} from '@storybook/react'

import {Switch} from './switch'

const meta = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  args: {defaultChecked: true},
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {defaultChecked: true},
}
export const Unchecked: Story = {
  args: {defaultChecked: false},
}
