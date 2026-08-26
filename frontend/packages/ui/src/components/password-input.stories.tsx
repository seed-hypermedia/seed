import type {Meta, StoryObj} from '@storybook/react'

import {PasswordInput} from './password-input'

const meta = {
  title: 'Components/PasswordInput',
  component: PasswordInput,
  tags: ['autodocs'],
  args: {
    id: 'password',
    label: 'Password',
    value: '',
    onChange: () => {},
    autoComplete: 'new-password',
    showStrength: true,
  },
} satisfies Meta<typeof PasswordInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    id: 'password',
    label: 'Password',
    value: '',
    onChange: () => {},
    autoComplete: 'new-password',
    showStrength: true,
  },
}
