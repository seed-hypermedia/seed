import type {Meta, StoryObj} from '@storybook/react'

import {Container, PanelContainer} from './container'

const meta = {
  title: 'Components/PanelContainer',
  component: PanelContainer,
  tags: ['autodocs'],
  args: {children: <div className="p-4">Panel body</div>},
} satisfies Meta<typeof PanelContainer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {children: <div className="p-4">Panel body</div>},
}
export const ContainerStory: Story = {
  args: {},
  render: () => (
    <Container centered>
      <div className="p-4">Centered container</div>
    </Container>
  ),
}
