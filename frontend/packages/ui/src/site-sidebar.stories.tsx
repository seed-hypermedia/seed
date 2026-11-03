import type {Meta, StoryObj} from '@storybook/react'
import {SiteSidebar} from './site-sidebar'
import {StoryProviders, storyId} from './story-fixtures'

const meta = {
  title: 'Pages/SiteSidebar',
  component: SiteSidebar,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <div className="h-[36rem] overflow-hidden rounded-lg border">
          <Story />
        </div>
      </StoryProviders>
    ),
  ],
  args: {
    siteId: storyId,
    unreadNotificationsBySite: {},
    onNavigate: () => {},
    children: <main className="p-6">Project notes</main>,
  },
} satisfies Meta<typeof SiteSidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
