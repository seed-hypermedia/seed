import type {Meta, StoryObj} from '@storybook/react'

import {ActivityHeader} from './activity-panel'

const meta = {
  title: 'Components/ActivityHeader',
  component: ActivityHeader,
  tags: ['autodocs'],
  args: {tab: 'all-updates', onTabChange: () => {}, onClose: () => {}, onExpand: () => {}},
} satisfies Meta<typeof ActivityHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ToYou: Story = {args: {tab: 'to-you'}}
