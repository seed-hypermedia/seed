import type {Meta, StoryObj} from '@storybook/react'
import {HMEntityField} from './hm-entity-field'
import {StoryProviders, storyId} from './story-fixtures'
const meta = {
  title: 'Components/HMEntityField',
  component: HMEntityField,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {value: storyId.id, mode: 'document', onValue: () => {}, ariaLabel: 'Document reference'},
} satisfies Meta<typeof HMEntityField>
export default meta
type Story = StoryObj<typeof meta>
export const Document: Story = {}
export const InvalidReference: Story = {args: {value: 'not-a-reference'}}
