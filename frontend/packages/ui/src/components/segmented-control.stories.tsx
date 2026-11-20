import type {Meta, StoryObj} from '@storybook/react'

import {SegmentedControl} from './segmented-control'

const meta = {
  title: 'Components/SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs'],
  args: {
    value: 'a',
    onChange: () => {},
    options: [
      {value: 'a', label: 'A'},
      {value: 'b', label: 'B'},
    ],
  },
} satisfies Meta<typeof SegmentedControl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    value: 'a',
    onChange: () => {},
    options: [
      {value: 'a', label: 'A'},
      {value: 'b', label: 'B'},
    ],
  },
}
