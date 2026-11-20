import type {Meta, StoryObj} from '@storybook/react'

import {ExportKeyDialog} from './export-key-dialog'

const meta = {
  title: 'Components/ExportKeyDialog',
  component: ExportKeyDialog,
  tags: ['autodocs'],
  args: {open: true, onOpenChange: () => {}, onExport: async () => {}, busy: false},
} satisfies Meta<typeof ExportKeyDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {open: true, onOpenChange: () => {}, onExport: async () => {}, busy: false},
}
