import type {Meta, StoryObj} from '@storybook/react'

import {AccountProfileForm} from './account-profile-form'

const meta = {
  title: 'Components/AccountProfileForm',
  component: AccountProfileForm,
  tags: ['autodocs'],
  args: {onSubmit: () => {}, initialName: 'Alice', initialDescription: 'About me'},
} satisfies Meta<typeof AccountProfileForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {onSubmit: () => {}, initialName: 'Alice', initialDescription: 'About me'},
}
