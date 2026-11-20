import type {Meta, StoryObj} from '@storybook/react'

import {SelectDropdown} from './select-dropdown'

const meta = {
  title: 'Components/SelectDropdown',
  component: SelectDropdown,
  tags: ['autodocs'],
  args: {
    options: [
      {value: 'a', label: 'Option A'},
      {value: 'b', label: 'Option B'},
    ],
    value: 'a',
    onValue: () => {},
    placeholder: 'Select an option',
  },
} satisfies Meta<typeof SelectDropdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    options: [
      {value: 'a', label: 'Option A'},
      {value: 'b', label: 'Option B'},
    ],
    value: 'a',
    onValue: () => {},
    placeholder: 'Select an option',
  },
}
