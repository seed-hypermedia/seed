import {createAnimations} from '@tamagui/animations-css'

export const animations = createAnimations({
  fast: 'ease-in-out 150ms',
  medium: 'ease-in-out 300ms',
  slow: 'ease-in-out 450ms',
  superSlow: 'ease-out 900ms',
  bounce: 'cubic-bezier(0.175, 0.885, 0.32, 1.275) 500ms',
})
