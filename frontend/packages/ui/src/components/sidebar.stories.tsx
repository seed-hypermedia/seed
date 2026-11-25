import type {Meta, StoryObj} from '@storybook/react'

import {SidebarMenu, SidebarMenuButton, SidebarMenuItem} from './sidebar'

const meta = {
  title: 'Components/SidebarMenuButton',
  component: SidebarMenuButton,
  tags: ['autodocs'],
  args: {children: 'Dashboard'},
} satisfies Meta<typeof SidebarMenuButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: 'Dashboard'},
  render: (args: any) => (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton {...args} />
      </SidebarMenuItem>
    </SidebarMenu>
  ),
}
