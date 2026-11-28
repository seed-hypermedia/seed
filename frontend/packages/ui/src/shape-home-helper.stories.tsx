import type {Meta, StoryObj} from '@storybook/react'
import {useState} from 'react'
import {ShapeHomeHelper, type ShapeHomeCandidateItem} from './shape-home-helper'

const SAMPLE: ShapeHomeCandidateItem[] = [
  {id: 'about', title: 'About'},
  {id: 'projects', title: 'Projects'},
  {id: 'blog', title: 'Blog'},
  {id: 'notes', title: 'Notes'},
  {id: 'photos', title: 'Photos'},
  {id: 'reading', title: 'Reading List'},
  {id: 'archive', title: 'Archive'},
  {id: 'drafts', title: 'Drafts'},
]

const meta = {
  title: 'Components/ShapeHomeHelper',
  component: ShapeHomeHelper,
  tags: ['autodocs'],
  args: {
    state: 'choosing',
    candidates: [],
    selected: new Set<string>(),
    showAll: false,
    onToggle: () => {},
    onShowMore: () => {},
    onAdd: () => {},
    onRetry: () => {},
    onNotNow: () => {},
  },
} satisfies Meta<typeof ShapeHomeHelper>

export default meta
type Story = StoryObj<typeof meta>

function Stateful(props: Partial<React.ComponentProps<typeof ShapeHomeHelper>>) {
  const [selected, setSelected] = useState<Set<string>>(new Set(SAMPLE.slice(0, 3).map((c) => c.id)))
  const [showAll, setShowAll] = useState(false)
  return (
    <ShapeHomeHelper
      state="choosing"
      candidates={SAMPLE}
      selected={selected}
      showAll={showAll}
      onToggle={(id) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelected(next)
      }}
      onShowMore={() => setShowAll(true)}
      onAdd={() => {}}
      onRetry={() => {}}
      onNotNow={() => {}}
      {...props}
    />
  )
}

export const Choosing: Story = {
  render: () => <Stateful />,
}

export const Adding: Story = {
  render: () => <Stateful state="adding" />,
}

export const Failed: Story = {
  render: () => <Stateful state="failed" error="Publish failed. Try again." />,
}

export const LoadFailed: Story = {
  render: () => <Stateful state="loadFailed" error="Network error" />,
}

export const Loading: Story = {
  render: () => <Stateful state="loading" candidates={[]} selected={new Set()} />,
}
