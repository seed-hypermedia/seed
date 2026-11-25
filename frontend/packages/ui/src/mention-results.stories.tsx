import type {Meta, StoryObj} from '@storybook/react'

import {MentionResults} from './mention-results'

const meta = {
  title: 'Components/MentionResults',
  component: MentionResults,
  tags: ['autodocs'],
  args: {
    id: 'mention-results',
    mode: 'document',
    suggestions: [],
    selected: 0,
    loading: false,
    error: false,
    onRetry: () => {},
    onSelect: () => {},
  },
} satisfies Meta<typeof MentionResults>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = {args: {loading: true}}
export const Error: Story = {args: {error: true}}
