import type {Meta, StoryObj} from '@storybook/react'

import {PanelHeader} from './panel-header'

const meta = {
  title: 'Components/PanelHeader',
  component: PanelHeader,
  tags: ['autodocs'],
  args: {title: 'Connections', count: 3, onClose: () => {}, onExpand: () => {}},
} satisfies Meta<typeof PanelHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = {args: {count: 0}}
export const Back: Story = {args: {onBack: () => {}}}
