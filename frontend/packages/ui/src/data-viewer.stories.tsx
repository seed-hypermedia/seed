import type {Meta, StoryObj} from '@storybook/react'

import {DataViewer} from './data-viewer'

const meta = {
  title: 'Components/DataViewer',
  component: DataViewer,
  tags: ['autodocs'],
  args: {
    data: {
      title: 'My Document',
      author: {name: 'Alice', id: 'alice'},
      tags: ['design', 'system'],
      metadata: {published: true, views: 42},
    },
    onNavigate: () => {},
  },
} satisfies Meta<typeof DataViewer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    data: {
      title: 'My Document',
      author: {name: 'Alice', id: 'alice'},
      tags: ['design', 'system'],
      metadata: {published: true, views: 42},
    },
    onNavigate: () => {},
  },
}
