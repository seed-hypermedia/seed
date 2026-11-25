import type {Meta, StoryObj} from '@storybook/react'

import {WebPublishedGraphic} from './publish-graphics'

const meta = {
  title: 'Components/PublishGraphics',
  component: WebPublishedGraphic,
  tags: ['autodocs'],
} satisfies Meta<typeof WebPublishedGraphic>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
