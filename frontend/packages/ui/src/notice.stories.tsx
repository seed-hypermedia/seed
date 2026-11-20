import type {Meta, StoryObj} from '@storybook/react'

import {Notice} from './notice'

const meta = {
  title: 'Components/Notice',
  component: Notice,
  tags: ['autodocs'],
  args: {title: 'Unable to load updates', children: 'Check your connection and try again.', onRetry: () => {}},
} satisfies Meta<typeof Notice>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Warning: Story = {args: {tone: 'warning', title: 'Some servers are unreachable'}}
export const Info: Story = {args: {tone: 'info', title: 'Your changes are saved locally'}}
export const Retrying: Story = {args: {retryPending: true}}
export const Minimal: Story = {args: {title: undefined, children: undefined, onRetry: undefined}}
