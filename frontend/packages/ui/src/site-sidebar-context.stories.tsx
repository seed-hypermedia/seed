import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {SiteSidebarProvider, SiteSidebarToggle} from './site-sidebar-context'
import {StoryProviders} from './story-fixtures'

function SidebarTogglePreview() {
  const [open, setOpen] = useState(true)
  return (
    <SiteSidebarProvider open={open} setOpen={setOpen}>
      <div className="flex items-center gap-3">
        <SiteSidebarToggle />
        <span className="text-muted-foreground text-sm">{open ? 'Sidebar open' : 'Sidebar closed'}</span>
      </div>
    </SiteSidebarProvider>
  )
}

const meta = {
  title: 'Components/SiteSidebarToggle',
  component: SiteSidebarToggle,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
} satisfies Meta<typeof SiteSidebarToggle>

export default meta
type Story = StoryObj<typeof meta>

export const Toggle: Story = {render: () => <SidebarTogglePreview />}
