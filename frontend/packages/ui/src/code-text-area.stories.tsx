import type {Meta, StoryObj} from '@storybook/react'
import {CodeTextArea} from './code-text-area'

const source = `export function greet(name: string) {\n  return \`Hello, \${name}\`\n}`

const meta = {
  title: 'Components/CodeTextArea',
  component: CodeTextArea,
  tags: ['autodocs'],
  args: {defaultValue: source, bare: false, 'aria-label': 'Source code'},
} satisfies Meta<typeof CodeTextArea>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Bare: Story = {
  args: {bare: true},
  render: (args) => (
    <div className="border-border flex h-48 flex-col rounded-md border">
      <CodeTextArea {...args} />
    </div>
  ),
}
export const Empty: Story = {args: {defaultValue: '', placeholder: '// Write code here'}}
