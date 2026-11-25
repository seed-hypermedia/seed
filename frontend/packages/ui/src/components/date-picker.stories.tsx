import type {Meta, StoryObj} from '@storybook/react'

import {DatePicker} from './date-picker'

const meta = {
  title: 'Components/DatePicker',
  component: DatePicker,
  tags: ['autodocs'],
  args: {value: '', onValue: () => {}, onReset: () => {}},
} satisfies Meta<typeof DatePicker>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {value: '', onValue: () => {}, onReset: () => {}},
}
