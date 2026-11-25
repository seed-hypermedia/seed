import type {Meta, StoryObj} from '@storybook/react'

import {PublishDomainStatus} from './publish-site'

const meta = {
  title: 'Components/PublishDomainStatus',
  component: PublishDomainStatus,
  tags: ['autodocs'],
  args: {
    hostname: 'notes.example.com',
    siteUrl: 'https://seed.hyper.media',
    status: 'waiting-dns',
    onRetry: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof PublishDomainStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Checking: Story = {args: {status: 'checking', checking: true}}
export const Publishing: Story = {args: {status: 'publishing'}}
export const Ready: Story = {args: {status: 'ready'}}
export const Error: Story = {args: {status: 'error', error: 'The domain could not be verified.'}}
