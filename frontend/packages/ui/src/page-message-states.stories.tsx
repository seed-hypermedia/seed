import type {Meta, StoryObj} from '@storybook/react'

import {PageDiscovery, PageMessageBox, PageRedirected} from './page-message-states'

const meta = {
  title: 'Components/PageMessageBox',
  component: PageMessageBox,
  tags: ['autodocs'],
  args: {title: 'Not Found', message: 'The page you are looking for does not exist.'},
} satisfies Meta<typeof PageMessageBox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {title: 'Not Found', message: 'The page you are looking for does not exist.'},
}
export const Redirected: Story = {
  args: {},
  render: () => (
    <PageRedirected redirectTarget={{id: 'hm://example', uid: 'example', type: 'd'} as any} onNavigate={() => {}} />
  ),
}

export const Discovery: Story = {
  args: {},
  render: () => <PageDiscovery entityType="document" />,
}
