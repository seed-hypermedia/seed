import type {Meta, StoryObj} from '@storybook/react'
import {DocumentPageParameters} from './document-page-parameters'
import {createDocumentPageInput} from '@shm/shared/document-page-input'
const input = createDocumentPageInput({
  schema: 'hm://hyper.media/example/person',
  client: {
    request: async () => {
      throw new Error('No external schema fixtures')
    },
  },
  navigate: () => {},
})
const meta = {
  title: 'Pages/DocumentPageParameters',
  component: DocumentPageParameters,
  tags: ['autodocs'],
  args: {input, onClose: () => {}},
} satisfies Meta<typeof DocumentPageParameters>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Unavailable: Story = {
  args: {
    input: createDocumentPageInput({
      schema: 'hm://unavailable/schema',
      client: {
        request: async () => {
          throw new Error('Schema is unavailable offline')
        },
      },
      navigate: () => {},
    }),
  },
}
