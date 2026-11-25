import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {Group, Panel} from 'react-resizable-panels'
import {AnimatedPanel, PanelSeparator} from './resizable-panels'
import {Button} from './button'
const meta = {
  title: 'Components/ResizablePanels',
  tags: ['autodocs'],
  render: function Panels() {
    const [open, setOpen] = useState(true)
    return (
      <div className="flex h-80 flex-col gap-4">
        <Button onClick={() => setOpen(!open)}>Toggle details</Button>
        <Group orientation="horizontal">
          <Panel id="main" defaultSize="70%">
            <div className="bg-muted h-full p-4">Document</div>
          </Panel>
          <PanelSeparator open={open} />
          <AnimatedPanel id="details" open={open} defaultSize="30%" minSize="20%">
            <div className="p-4">Details panel</div>
          </AnimatedPanel>
        </Group>
      </div>
    )
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
