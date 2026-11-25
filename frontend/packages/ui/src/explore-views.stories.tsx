import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {ExploreViewSwitcher} from './explore-views'
const meta = {
  title: 'Components/ExploreViewSwitcher',
  component: ExploreViewSwitcher,
  tags: ['autodocs'],
  args: {view: 'list', onChange: () => {}},
  render: function Controlled(args) {
    const [view, setView] = useState(args.view)
    return <ExploreViewSwitcher view={view} onChange={setView} />
  },
} satisfies Meta<typeof ExploreViewSwitcher>
export default meta
type Story = StoryObj<typeof meta>
export const List: Story = {}
export const Cards: Story = {args: {view: 'card'}}
export const Table: Story = {args: {view: 'table'}}
