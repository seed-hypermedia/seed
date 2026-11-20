import type {Meta, StoryObj} from '@storybook/react'

import {TooltipProvider} from './tooltip'
import {FocusButton} from './list-item'

const meta = {
  title: 'Components/FocusButton',
  component: FocusButton,
  tags: ['autodocs'],
  args: {onPress: () => {}, label: 'Document'},
} satisfies Meta<typeof FocusButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {onPress: () => {}, label: 'Document'},
  render: (args: any) => (
    <TooltipProvider>
      <FocusButton {...args} />
    </TooltipProvider>
  ),
}
