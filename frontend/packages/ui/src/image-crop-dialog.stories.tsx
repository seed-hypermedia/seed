import type {Meta, StoryObj} from '@storybook/react'
import {ImageCropDialog} from './image-crop-dialog'
const meta = {
  title: 'Components/ImageCropDialog',
  component: ImageCropDialog,
  tags: ['autodocs'],
  args: {input: null, onClose: () => {}},
} satisfies Meta<typeof ImageCropDialog>
export default meta
type Story = StoryObj<typeof meta>
export const Closed: Story = {}
export const Open: Story = {
  args: {
    input: {
      file: new File(
        [
          Uint8Array.from(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),
            (byte) => byte.charCodeAt(0),
          ),
        ],
        'fixture.png',
        {type: 'image/png'},
      ),
      aspect: 1,
      maxDimension: 256,
      onCropped: () => {},
    },
  },
}
export const InvalidImage: Story = {
  args: {
    input: {
      file: new File(['not an image'], 'invalid.png', {type: 'image/png'}),
      aspect: 1,
      maxDimension: 256,
      onCropped: () => {},
    },
  },
}
