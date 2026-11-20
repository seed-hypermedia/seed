import type {Meta, StoryObj} from '@storybook/react'

import {Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow} from './table'

const meta = {
  title: 'Components/Table',
  component: Table,
  tags: ['autodocs'],
  args: {},
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>A list of recent invoices.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>INV001</TableCell>
          <TableCell>Paid</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}
