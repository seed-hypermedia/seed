import type {Meta, StoryObj} from '@storybook/react'

import {SeedHeading} from './heading'

const meta = {
  title: 'Components/SeedHeading',
  component: SeedHeading,
  tags: ['autodocs'],
  args: {children: 'Heading', level: 2},
} satisfies Meta<typeof SeedHeading>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: 'Heading', level: 2},
}
export const Level3: Story = {
  args: {children: 'Heading 3', level: 3},
}

export const Level4: Story = {
  args: {children: 'Heading 4', level: 4},
}
