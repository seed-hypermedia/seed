import type {Meta, StoryObj} from '@storybook/react'

import {PageLayout} from './page-layout'

const meta = {
  title: 'Components/PageLayout',
  component: PageLayout,
  tags: ['autodocs'],
  args: {title: 'Page Title', children: <div className="p-4">Page content</div>},
} satisfies Meta<typeof PageLayout>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {title: 'Page Title', children: <div className="p-4">Page content</div>},
}
