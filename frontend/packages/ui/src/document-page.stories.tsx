import type {Meta, StoryObj} from '@storybook/react'
import {DocumentPageView} from './document-page'
import {StoryProviders, storyDocument, storyId} from './story-fixtures'
const meta = {
  title: 'Pages/DocumentPage',
  component: DocumentPageView,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {docId: storyId, document: storyDocument, cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'},
} satisfies Meta<typeof DocumentPageView>
export default meta
type Story = StoryObj<typeof meta>
export const LaunchApproval: Story = {}
export const UnnamedPage: Story = {args: {document: {...storyDocument, metadata: {}}}}
