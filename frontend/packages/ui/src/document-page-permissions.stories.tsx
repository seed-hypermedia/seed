import type {Meta, StoryObj} from '@storybook/react'
import {DocumentPagePermissionPrompt, DocumentPagePermissionSettings} from './document-page-permissions'
import {StoryProviders} from './story-fixtures'
const meta = {
  title: 'Pages/DocumentPagePermissions',
  component: DocumentPagePermissionPrompt,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {
    pageName: 'Project dashboard',
    accountName: 'Ada',
    request: {kind: 'read', type: 'Resource', title: 'Read a document', details: {}},
    onDecision: () => {},
  },
} satisfies Meta<typeof DocumentPagePermissionPrompt>
export default meta
type Story = StoryObj<typeof meta>
export const Read: Story = {}
export const Sign: Story = {
  args: {
    request: {
      kind: 'sign',
      type: 'Comment',
      title: 'Sign a comment',
      details: {payload: {body: [{text: 'Ready for review'}]}},
    },
  },
}
export const Warning: Story = {
  args: {
    request: {
      kind: 'publish',
      type: 'raw',
      title: 'Publish data',
      details: {},
      warning: 'Review this request carefully.',
    },
  },
}
export const EmptySettings: Story = {
  render: () => (
    <DocumentPagePermissionSettings
      open
      onOpenChange={() => {}}
      pageName="Project dashboard"
      grants={[]}
      onRemove={() => {}}
      onReset={() => {}}
    />
  ),
}
