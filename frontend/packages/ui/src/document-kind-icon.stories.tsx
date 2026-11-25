import type {Meta, StoryObj} from '@storybook/react'
import {DocumentKindIcon, type DocumentKind} from './document-kind-icon'

const kinds: DocumentKind[] = ['document', 'collection', 'private', 'agent', 'app', 'tool']

const meta = {
  title: 'Components/DocumentKindIcon',
  component: DocumentKindIcon,
  tags: ['autodocs'],
  args: {kind: 'document', className: 'size-4'},
  argTypes: {kind: {control: 'select', options: kinds}},
} satisfies Meta<typeof DocumentKindIcon>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const AllKinds: Story = {
  render: (args) => (
    <ul className="flex flex-col gap-2">
      {kinds.map((kind) => (
        <li key={kind} className="flex items-center gap-2 text-sm">
          <DocumentKindIcon {...args} kind={kind} className="text-muted-foreground size-4" />
          {kind}
        </li>
      ))}
    </ul>
  ),
}
