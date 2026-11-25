import type {Meta, StoryObj} from '@storybook/react'

import {DeletionDocumentList} from './deletion-document-list'

const meta = {
  title: 'Components/DeletionDocumentList',
  component: DeletionDocumentList,
  tags: ['autodocs'],
  args: {
    documents: [
      {key: 'one', title: 'Project notes', path: ['projects', 'notes']},
      {key: 'two', title: 'Meeting notes', path: ['meetings']},
    ],
    label: 'Documents to delete',
  },
} satisfies Meta<typeof DeletionDocumentList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = {args: {documents: []}}
