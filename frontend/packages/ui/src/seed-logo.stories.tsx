import type {Meta, StoryObj} from '@storybook/react'

import {SeedLogo} from './seed-logo'

const meta = {
  title: 'Components/SeedLogo',
  component: SeedLogo,
  tags: ['autodocs'],
  args: {},
} satisfies Meta<typeof SeedLogo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}
