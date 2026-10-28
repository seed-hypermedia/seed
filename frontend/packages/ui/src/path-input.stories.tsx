import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'

import {PathInput} from './path-input'

const meta = {
  title: 'Components/PathInput',
  component: PathInput,
  tags: ['autodocs'],
  args: {value: 'project-notes', onValueChange: () => {}},
  render: function Controlled(args) {
    const [value, setValue] = useState(args.value)
    return <PathInput {...args} value={value} onValueChange={setValue} />
  },
} satisfies Meta<typeof PathInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = {args: {value: '', placeholder: 'Document path'}}
export const Disabled: Story = {args: {disabled: true}}
