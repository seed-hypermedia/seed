import type {Meta, StoryObj} from '@storybook/react'

import {DeleteDocumentDialog} from './delete-document-dialog'

const meta = {
  title: 'Components/DeleteDocumentDialog',
  component: DeleteDocumentDialog,
  tags: ['autodocs'],
  args: {document: {key: 'doc-1', title: 'My Document'}, onConfirm: async () => {}, canDelete: true},
} satisfies Meta<typeof DeleteDocumentDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {document: {key: 'doc-1', title: 'My Document'}, onConfirm: async () => {}, canDelete: true},
}
