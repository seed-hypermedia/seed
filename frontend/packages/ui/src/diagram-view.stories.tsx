import type {Meta, StoryObj} from '@storybook/react'
import {DiagramView} from './diagram-view'
const meta = {
  title: 'Components/DiagramView',
  component: DiagramView,
  tags: ['autodocs'],
  args: {
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><rect x="10" y="20" width="140" height="70" rx="8" fill="#dbeafe"/><text x="40" y="60">Draft</text><path d="M160 55h70" stroke="currentColor"/><rect x="240" y="20" width="150" height="70" rx="8" fill="#dcfce7"/><text x="260" y="60">Published</text></svg>',
  },
} satisfies Meta<typeof DiagramView>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Empty: Story = {args: {svg: ''}}
