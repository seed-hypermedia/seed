import type {Meta, StoryObj} from '@storybook/react'

import {TooltipProvider} from './tooltip'
import {InlineError} from './inline-feedback'

const meta = {
  title: 'Components/InlineError',
  component: InlineError,
  tags: ['autodocs'],
  args: {message: 'Could not be found'},
} satisfies Meta<typeof InlineError>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {message: 'Could not be found'},
  render: (args: any) => (
    <TooltipProvider>
      <InlineError {...args} />
    </TooltipProvider>
  ),
}
