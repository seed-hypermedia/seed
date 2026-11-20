import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {AgentWriteScopePicker, type AgentWriteScope} from './write-access'

const meta = {
  title: 'Components/AgentWriteScopePicker',
  component: AgentWriteScopePicker,
  tags: ['autodocs'],
  args: {value: 'document', onChange: () => {}, disabled: false},
  argTypes: {
    value: {control: 'radio', options: ['none', 'document', 'space']},
    minimum: {control: 'radio', options: [undefined, 'none', 'document', 'space']},
  },
} satisfies Meta<typeof AgentWriteScopePicker>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: function Picker(args) {
    const [value, setValue] = useState<AgentWriteScope>(args.value)
    return <AgentWriteScopePicker {...args} value={value} onChange={setValue} />
  },
}
export const CannotRevoke: Story = {args: {value: 'space', minimum: 'document'}}
export const Locked: Story = {args: {disabled: true}}
