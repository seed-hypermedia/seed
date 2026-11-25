import type {Meta, StoryObj} from '@storybook/react'
import {Button} from './button'
import {ServerHostSection} from './server-host-card'

const meta = {
  title: 'Components/ServerHostSection',
  component: ServerHostSection,
  tags: ['autodocs'],
  args: {serverUrl: 'https://agents.example.com', detail: 'Running'},
} satisfies Meta<typeof ServerHostSection>
export default meta
type Story = StoryObj<typeof meta>
export const Hosted: Story = {
  args: {
    action: (
      <Button variant="outline" size="sm">
        Change
      </Button>
    ),
  },
}
export const ThisComputer: Story = {
  args: {serverUrl: 'http://localhost:56001', localServerUrl: 'http://localhost:56001', detail: 'Started with the app'},
}
export const NotHosted: Story = {
  args: {serverUrl: '', emptyDetail: 'Choose a server to run this app.'},
}
