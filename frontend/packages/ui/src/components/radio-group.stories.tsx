import type {Meta, StoryObj} from '@storybook/react'

import {RadioGroup, RadioGroupItem} from './radio-group'

const meta = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  args: {defaultValue: 'a'},
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {defaultValue: 'a'},
  render: (args: any) => (
    <RadioGroup {...args} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="a" id="r1" />
        <label htmlFor="r1">Option A</label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="b" id="r2" />
        <label htmlFor="r2">Option B</label>
      </div>
    </RadioGroup>
  ),
}
