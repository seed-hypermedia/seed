import type {Meta, StoryObj} from '@storybook/react'

import {FooterWrapper} from './footer'

const meta = {
  title: 'Components/FooterWrapper',
  component: FooterWrapper,
  tags: ['autodocs'],
  args: {children: <span className="px-2 text-xs">Footer content</span>},
} satisfies Meta<typeof FooterWrapper>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: <span className="px-2 text-xs">Footer content</span>},
}
