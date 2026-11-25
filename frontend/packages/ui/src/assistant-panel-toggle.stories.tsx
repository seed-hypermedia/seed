import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {AssistantPanelHeaderButton, AssistantPanelMenuItem, AssistantPanelToggleContext} from './assistant-panel-toggle'

type ToggleArgs = {initiallyOpen: boolean; orphans: number}

function HostedToggle({initiallyOpen, orphans, menu}: ToggleArgs & {menu?: boolean}) {
  const [isOpen, setOpen] = useState(initiallyOpen)
  return (
    <AssistantPanelToggleContext.Provider value={{isOpen, orphans, toggle: () => setOpen(!isOpen)}}>
      {menu ? <AssistantPanelMenuItem /> : <AssistantPanelHeaderButton />}
    </AssistantPanelToggleContext.Provider>
  )
}

const meta = {
  title: 'Components/AssistantPanelToggle',
  component: HostedToggle,
  tags: ['autodocs'],
  args: {initiallyOpen: false, orphans: 0},
  argTypes: {orphans: {control: {type: 'number', min: 0}}},
} satisfies Meta<typeof HostedToggle>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Open: Story = {args: {initiallyOpen: true}}
export const WithOrphanAgents: Story = {args: {orphans: 2}}
export const MenuItem: Story = {args: {menu: true, orphans: 1}}
export const NoHost: Story = {render: () => <AssistantPanelHeaderButton />}
