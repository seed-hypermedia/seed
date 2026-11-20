import type {Meta, StoryObj} from '@storybook/react'

import {ExploreState} from './explore-primitives'

const meta = {
  title: 'Components/ExploreState',
  component: ExploreState,
  tags: ['autodocs'],
  args: {icon: null, title: 'No documents found', detail: 'Try a different search or filter.'},
} satisfies Meta<typeof ExploreState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = {args: {title: 'Loading documents', detail: 'Searching the network…'}}
export const Error: Story = {
  args: {tone: 'error', title: 'Unable to search', detail: 'Check your connection and retry.'},
}
