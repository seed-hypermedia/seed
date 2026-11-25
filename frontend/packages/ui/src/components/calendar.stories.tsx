import type {Meta, StoryObj} from '@storybook/react'

import {Calendar} from './calendar'

const meta = {
  title: 'Components/Calendar',
  component: Calendar,
  tags: ['autodocs'],
  args: {mode: 'single', selected: new Date(), onSelect: () => {}},
} satisfies Meta<typeof Calendar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {mode: 'single', selected: new Date(), onSelect: () => {}},
}
