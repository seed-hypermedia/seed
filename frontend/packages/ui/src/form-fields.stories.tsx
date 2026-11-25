import type {Meta, StoryObj} from '@storybook/react'

import {Input} from './components/input'
import {Field, SelectField, TextField} from './form-fields'

const meta = {
  title: 'Components/Field',
  component: Field,
  tags: ['autodocs'],
  args: {id: 'name', label: 'Name'},
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {id: 'name', label: 'Name'},
  render: (args: any) => (
    <Field {...args}>
      <Input id="name" placeholder="Enter name" />
    </Field>
  ),
}
export const TextFieldStory: StoryObj<typeof TextField> = {
  args: {id: 'email', label: 'Email', placeholder: 'Enter email'},
}

export const SelectFieldStory: StoryObj<typeof SelectField> = {
  args: {
    id: 'role',
    label: 'Role',
    options: [
      {value: 'admin', label: 'Admin'},
      {value: 'member', label: 'Member'},
    ],
  },
}
