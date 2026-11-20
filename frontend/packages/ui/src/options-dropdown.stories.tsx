import type {Meta, StoryObj} from '@storybook/react'

import {OptionsDropdown} from './options-dropdown'

const meta = {
  title: 'Components/OptionsDropdown',
  component: OptionsDropdown,
  tags: ['autodocs'],
  args: {
    menuItems: [
      {key: 'edit', label: 'Edit', icon: <div className="bg-primary size-4 rounded-sm" />, onClick: () => {}},
      {key: 'delete', label: 'Delete', icon: <div className="bg-destructive size-4 rounded-sm" />, onClick: () => {}},
    ],
  },
} satisfies Meta<typeof OptionsDropdown>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    menuItems: [
      {key: 'edit', label: 'Edit', icon: <div className="bg-primary size-4 rounded-sm" />, onClick: () => {}},
      {key: 'delete', label: 'Delete', icon: <div className="bg-destructive size-4 rounded-sm" />, onClick: () => {}},
    ],
  },
}
