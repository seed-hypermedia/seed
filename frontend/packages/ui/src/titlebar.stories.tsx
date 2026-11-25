import type {Meta, StoryObj} from '@storybook/react'

import {TitlebarWrapper} from './titlebar'

const meta = {
  title: 'Components/TitlebarWrapper',
  component: TitlebarWrapper,
  tags: ['autodocs'],
  args: {children: <div className="px-2 text-sm font-bold">Titlebar</div>},
} satisfies Meta<typeof TitlebarWrapper>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: <div className="px-2 text-sm font-bold">Titlebar</div>},
}
