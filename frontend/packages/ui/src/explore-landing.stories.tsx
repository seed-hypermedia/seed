import type {Meta, StoryObj} from '@storybook/react'
import {ExploreJumpTo} from './explore-landing'
const meta = {
  title: 'Pages/ExploreLanding',
  component: ExploreJumpTo,
  tags: ['autodocs'],
  args: {active: [], kinds: ['document', 'space', 'contact'], onJump: () => {}},
} satisfies Meta<typeof ExploreJumpTo>
export default meta
type Story = StoryObj<typeof meta>
export const JumpTo: Story = {}
export const Selected: Story = {args: {active: ['document']}}
export const Empty: Story = {args: {kinds: []}}
