import type {Meta, StoryObj} from '@storybook/react'
import {DocumentMaintenance, DocumentMaintenanceTrigger, DocumentMaintenanceBanner} from './document-maintenance'
import {StoryProviders, storyId} from './story-fixtures'
const meta = {
  title: 'Components/DocumentMaintenance',
  component: DocumentMaintenance,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {
    items: [],
    onRetry: async () => {},
    onDismiss: async () => {},
    onOpenDocument: () => {},
    children: (
      <>
        <DocumentMaintenanceTrigger alwaysVisible />
        <DocumentMaintenanceBanner />
      </>
    ),
  },
} satisfies Meta<typeof DocumentMaintenance>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const NeedsAttention: Story = {
  args: {
    items: [
      {
        id: 'cleanup',
        title: 'Delete unreferenced children',
        status: 'Failed',
        needsAttention: true,
        error: 'Connection lost. Your draft is safe.',
        documents: [{id: storyId.id, label: 'Project notes'}],
        canRetry: true,
      },
    ],
  },
}
export const LoadError: Story = {args: {loadError: 'Could not load maintenance history.'}}
