import type {Meta, StoryObj} from '@storybook/react'

import {ProfileName} from './profile-name'

const meta = {
  title: 'Components/ProfileName',
  component: ProfileName,
  tags: ['autodocs'],
  args: {publicName: 'Alice Example', petname: 'Alice', onSave: async () => {}},
} satisfies Meta<typeof ProfileName>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ReadOnly: Story = {args: {onSave: undefined}}
export const EmptyContactName: Story = {args: {petname: undefined}}
export const SaveError: Story = {
  args: {
    onSave: async () => {
      throw new Error('Unable to save contact name')
    },
  },
}
