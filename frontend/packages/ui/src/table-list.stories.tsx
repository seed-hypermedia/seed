import type {Meta, StoryObj} from '@storybook/react'

import {TableList} from './table-list'

const meta = {
  title: 'Components/TableList',
  component: TableList,
  tags: ['autodocs'],
  args: {
    children: (
      <>
        <TableList.Header>Details</TableList.Header>
        <TableList.Item>
          <span className="text-muted-foreground w-32 flex-none">ID</span>
          <span>123</span>
        </TableList.Item>
        <TableList.Item>
          <span className="text-muted-foreground w-32 flex-none">Status</span>
          <span>Active</span>
        </TableList.Item>
      </>
    ),
  },
} satisfies Meta<typeof TableList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    children: (
      <>
        <TableList.Header>Details</TableList.Header>
        <TableList.Item>
          <span className="text-muted-foreground w-32 flex-none">ID</span>
          <span>123</span>
        </TableList.Item>
        <TableList.Item>
          <span className="text-muted-foreground w-32 flex-none">Status</span>
          <span>Active</span>
        </TableList.Item>
      </>
    ),
  },
}
