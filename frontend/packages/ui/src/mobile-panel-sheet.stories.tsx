import type {Meta, StoryObj} from '@storybook/react'

import {MobilePanelSheet} from './mobile-panel-sheet'

const meta = {
  title: 'Components/MobilePanelSheet',
  component: MobilePanelSheet,
  tags: ['autodocs'],
  args: {isOpen: true, title: 'Panel', onClose: () => {}, children: <div className="p-4">Panel content</div>},
} satisfies Meta<typeof MobilePanelSheet>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {isOpen: true, title: 'Panel', onClose: () => {}, children: <div className="p-4">Panel content</div>},
}
