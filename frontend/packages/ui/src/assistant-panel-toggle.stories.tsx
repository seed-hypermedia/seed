import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {AssistantPanelToggleContext, AssistantPanelHeaderButton} from './assistant-panel-toggle'
import {StoryProviders, storyId, storyClient, storyDocument} from './story-fixtures'
const client = {
  ...storyClient,
  request: (async () => ({
    type: 'document',
    id: storyId,
    document: {...storyDocument, metadata: {agentServerUrl: 'https://agents.example.invalid'}},
  })) as typeof storyClient.request,
}
const meta = {
  title: 'Components/AssistantPanelToggle',
  component: AssistantPanelHeaderButton,
  tags: ['autodocs'],
  args: {siteUid: storyId.uid},
  decorators: [
    (Story) => (
      <StoryProviders client={client}>
        <Story />
      </StoryProviders>
    ),
  ],
  render: function Toggle(args) {
    const [isOpen, setOpen] = useState(false)
    return (
      <AssistantPanelToggleContext.Provider value={{isOpen, toggle: () => setOpen(!isOpen)}}>
        <AssistantPanelHeaderButton {...args} />
      </AssistantPanelToggleContext.Provider>
    )
  },
} satisfies Meta<typeof AssistantPanelHeaderButton>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const NoHost: Story = {render: (args) => <AssistantPanelHeaderButton {...args} />}
