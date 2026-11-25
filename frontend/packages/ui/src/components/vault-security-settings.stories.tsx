import type {Meta, StoryObj} from '@storybook/react'

import {VaultSecuritySettings} from './vault-security-settings'

const meta = {
  title: 'Components/VaultSecuritySettings',
  component: VaultSecuritySettings,
  tags: ['autodocs'],
  args: {
    password: {isSet: true, onSet: async () => {}},
    email: {address: 'user@example.com', onStart: async () => {}, onVerify: async () => {}},
    notify: {url: '', defaultUrl: 'https://notify.example.com', onSave: async () => {}},
    logout: {description: 'Sign out of this vault.', onLogOut: () => {}},
    disabled: false,
  },
} satisfies Meta<typeof VaultSecuritySettings>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    password: {isSet: true, onSet: async () => {}},
    email: {address: 'user@example.com', onStart: async () => {}, onVerify: async () => {}},
    notify: {url: '', defaultUrl: 'https://notify.example.com', onSave: async () => {}},
    logout: {description: 'Sign out of this vault.', onLogOut: () => {}},
    disabled: false,
  },
}
