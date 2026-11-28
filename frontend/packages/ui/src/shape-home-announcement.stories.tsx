import type {Meta, StoryObj} from '@storybook/react'

import {Dialog, DialogContent} from './components/dialog'
import {ShapeHomeAnnouncement} from './shape-home-announcement'

const meta = {
  title: 'Components/ShapeHomeAnnouncement',
  component: ShapeHomeAnnouncement,
  tags: ['autodocs'],
  args: {
    candidateTitles: ['About', 'Projects', 'Blog'],
    onLearnMore: () => {},
    onNotNow: () => {},
    onShapeHome: () => {},
  },
} satisfies Meta<typeof ShapeHomeAnnouncement>

export default meta
type Story = StoryObj<typeof meta>

function WithDialog(children: React.ReactNode) {
  return (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-lg">{children}</DialogContent>
    </Dialog>
  )
}

export const Ready: Story = {
  args: {
    candidateTitles: ['About', 'Projects', 'A very long document title that should truncate with an ellipsis'],
  },
  render: (args) => WithDialog(<ShapeHomeAnnouncement {...args} />),
}

export const Loading: Story = {
  args: {
    candidateTitles: [],
  },
  render: (args) => WithDialog(<ShapeHomeAnnouncement {...args} />),
}

export const Empty: Story = {
  args: {
    candidateTitles: [],
  },
  render: (args) => WithDialog(<ShapeHomeAnnouncement {...args} />),
}
