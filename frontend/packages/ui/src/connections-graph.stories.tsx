import type {Meta, StoryObj} from '@storybook/react'
import type {DocumentConnection} from '@shm/shared/connections'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {ConnectionsGraph} from './connections-graph'
import {StoryProviders, storyId} from './story-fixtures'

const groups: DocumentConnection[] = [
  {id: hmId(storyId.uid, {path: ['design-system']}), sources: []},
  {id: hmId(storyId.uid, {path: ['project-plan']}), sources: []},
]

const meta = {
  title: 'Components/ConnectionsGraph',
  component: ConnectionsGraph,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <div className="max-w-3xl">
          <Story />
        </div>
      </StoryProviders>
    ),
  ],
  args: {docId: storyId, groups, expandedIds: new Set(), onSelect: () => {}},
} satisfies Meta<typeof ConnectionsGraph>

export default meta
type Story = StoryObj<typeof meta>

export const RelatedDocuments: Story = {}
