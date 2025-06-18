import {Button as TButton} from '@tamagui/button'
import {styled} from '@tamagui/web'

export const Button = styled(TButton, {
  className: 'btn',
  // bg: "$color4",
  borderWidth: 2,
  // bg: "$color4",
  // borderColor: "$color5",
  // hoverStyle: {
  //   bg: "$color5",
  //   borderColor: "$color6",
  //   elevation: 0,
  // },
  disabledStyle: {
    opacity: 0.5,
    borderWidth: 2,
    borderColor: '$colorTransparent',
    elevation: 0,
  },

  focusStyle: {
    borderColor: '$color8',
    borderWidth: 2,
    elevation: 0,
  },
  hoverStyle: {
    cursor: 'default',
  },
})

// export function Button({ icon, ...props }: { icon: React.ReactNode }) {

// }
