import type {Meta, StoryObj} from '@storybook/react'

import {List} from './list'

const meta = {
  title: 'Components/List',
  component: List,
  tags: ['autodocs'],
  args: {
    items: ['Item 1', 'Item 2', 'Item 3'],
    renderItem: ({item}: any) => <div className="border-b p-2 last:border-0">{String(item)}</div>,
    fixedItemHeight: 40,
  },
} satisfies Meta<typeof List>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    items: ['Item 1', 'Item 2', 'Item 3'],
    renderItem: ({item}: any) => <div className="border-b p-2 last:border-0">{String(item)}</div>,
    fixedItemHeight: 40,
  },
}
