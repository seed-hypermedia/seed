import type {Meta, StoryObj} from '@storybook/react'

import {FacePile} from './face-pile'

const meta = {
  title: 'Components/FacePile',
  component: FacePile,
  tags: ['autodocs'],
  args: {accounts: [], accountsMetadata: {}},
} satisfies Meta<typeof FacePile>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {accounts: [], accountsMetadata: {}},
}
