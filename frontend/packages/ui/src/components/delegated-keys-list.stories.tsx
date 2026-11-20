import type {Meta, StoryObj} from '@storybook/react'

import {DelegatedKeysList} from './delegated-keys-list'

const meta = {
  title: 'Components/DelegatedKeysList',
  component: DelegatedKeysList,
  tags: ['autodocs'],
  args: {items: [{id: '1', title: 'MacBook', dateLabel: '2 days ago'}]},
} satisfies Meta<typeof DelegatedKeysList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {items: [{id: '1', title: 'MacBook', dateLabel: '2 days ago'}]},
}
