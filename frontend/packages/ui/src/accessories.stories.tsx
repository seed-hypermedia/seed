import type {Meta, StoryObj} from '@storybook/react'

import {PanelContent, SelectionBackButton, SelectionContent} from './accessories'

const meta = {
  title: 'Components/SelectionBackButton',
  component: SelectionBackButton,
  tags: ['autodocs'],
  args: {onClick: () => {}, label: 'Back'},
} satisfies Meta<typeof SelectionBackButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {onClick: () => {}, label: 'Back'},
}
export const Panel: Story = {
  args: {},
  render: () => (
    <PanelContent header={<span className="font-semibold">Panel header</span>}>
      <div className="p-4">Panel body</div>
    </PanelContent>
  ),
}

export const Selection: Story = {
  args: {},
  render: () => (
    <SelectionContent>
      <div className="p-4">Selection content</div>
    </SelectionContent>
  ),
}
