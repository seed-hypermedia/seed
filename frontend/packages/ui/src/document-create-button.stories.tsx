import type {Meta, StoryObj} from '@storybook/react'

import {DocumentCreateButton} from './document-create-button'

const meta = {
  title: 'Components/DocumentCreateButton',
  component: DocumentCreateButton,
  tags: ['autodocs'],
  args: {onCreate: () => {}, onImport: () => {}, showSubdocument: true},
} satisfies Meta<typeof DocumentCreateButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Disabled: Story = {args: {disabled: true}}
export const Hidden: Story = {args: {hidden: true}}
