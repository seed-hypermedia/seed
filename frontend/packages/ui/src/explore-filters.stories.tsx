import type {Meta, StoryObj} from '@storybook/react'

import {ActiveFilterChip, ActiveFilterChipRow, FilterChipButton} from './explore-filters'

const meta = {
  title: 'Components/ExploreFilters',
  component: FilterChipButton,
  tags: ['autodocs'],
  args: {label: 'Document type', onClick: () => {}},
} satisfies Meta<typeof FilterChipButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Active: Story = {args: {active: true, label: 'Documents'}}
export const Open: Story = {args: {open: true}}
export const AppliedFilters: Story = {
  render: () => (
    <ActiveFilterChipRow onClear={() => {}}>
      <ActiveFilterChip onRemove={() => {}} removeLabel="Remove document type filter">
        Documents
      </ActiveFilterChip>
    </ActiveFilterChipRow>
  ),
}
