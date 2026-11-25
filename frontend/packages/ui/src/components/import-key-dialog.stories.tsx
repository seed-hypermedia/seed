import type {Meta, StoryObj} from '@storybook/react'

import {ImportKeyDialog} from './import-key-dialog'

const meta = {
  title: 'Components/ImportKeyDialog',
  component: ImportKeyDialog,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    renderFileField: () => <input type="file" />,
    hasFile: true,
    onImport: async () => {},
  },
} satisfies Meta<typeof ImportKeyDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    renderFileField: () => <input type="file" />,
    hasFile: true,
    onImport: async () => {},
  },
}
