import type {Meta, StoryObj} from '@storybook/react'
import {ConnectionsPanel} from './connections-panel'
import {StoryProviders, storyClient, storyId} from './story-fixtures'
const meta = {
  title: 'Pages/ConnectionsPanel',
  component: ConnectionsPanel,
  tags: ['autodocs'],
  args: {docId: storyId},
} satisfies Meta<typeof ConnectionsPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
}
export const RelatedDocument: Story = {
  decorators: [
    (Story) => (
      <StoryProviders
        client={{
          ...storyClient,
          request: (async (method: string) =>
            method === 'ListCitations'
              ? {
                  citations: [
                    {
                      source: `${storyId.id}-related`,
                      sourceType: 'Ref',
                      sourceContext: 'paragraph',
                      citationType: 'doc/Link',
                      sourceBlob: {cid: 'fixture', createTime: '2026-10-20T10:00:00Z'},
                    },
                  ],
                }
              : storyClient.request('Resource', storyId)) as typeof storyClient.request,
        }}
      >
        <Story />
      </StoryProviders>
    ),
  ],
}
export const Loading: Story = {
  decorators: [
    (Story) => (
      <StoryProviders client={{...storyClient, request: () => new Promise<never>(() => {})}}>
        <Story />
      </StoryProviders>
    ),
  ],
}
export const Unavailable: Story = {
  decorators: [
    (Story) => (
      <StoryProviders
        client={{
          ...storyClient,
          request: async () => {
            throw new Error('Offline')
          },
        }}
      >
        <Story />
      </StoryProviders>
    ),
  ],
}
