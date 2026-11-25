import type {Meta, StoryObj} from '@storybook/react'

import {CodeInput} from './code-input'

const meta = {
  title: 'Components/CodeInput',
  component: CodeInput,
  tags: ['autodocs'],
  args: {value: '', onChange: () => {}, length: 6, onComplete: () => {}},
} satisfies Meta<typeof CodeInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {value: '', onChange: () => {}, length: 6, onComplete: () => {}},
}
