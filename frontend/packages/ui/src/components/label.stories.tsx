import type {Meta, StoryObj} from '@storybook/react'

import {Label} from './label'

const meta = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
  args: {children: 'Label text'},
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: 'Label text'},
}
