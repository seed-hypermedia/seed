import type {Meta, StoryObj} from '@storybook/react'
import {AppRunStatus} from './running'

const run = {
  appId: 'hm://z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB/apps/weather',
  spaceUid: 'z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB',
  startedBy: 'z6MkfzKMhF9k1oPaQsShWAg8xJzbWf5kaZgn1MkeZvhcAsmB',
  privateConfigKeys: [],
  createdAt: 1792000000000,
  updatedAt: 1792000000000,
}

const meta = {
  title: 'Components/AppRunStatus',
  component: AppRunStatus,
  tags: ['autodocs'],
  args: {serverUrl: 'https://apps.example.com', run},
} satisfies Meta<typeof AppRunStatus>
export default meta
type Story = StoryObj<typeof meta>
export const Running: Story = {}
export const NotRunning: Story = {args: {run: null}}
export const Checking: Story = {args: {run: undefined, loading: true}}
export const Unreachable: Story = {args: {run: undefined, error: new Error('fetch failed')}}
export const NoServer: Story = {args: {serverUrl: '', run: null}}
