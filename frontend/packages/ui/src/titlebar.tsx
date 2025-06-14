// @ts-nocheck
import {ButtonText, styled, XStack, YStack} from 'tamagui'
import {SizableText} from './text'

export const TitlebarWrapper = styled(YStack, {
  name: 'TitlebarWrapper',
  // className: "window-drag",
  // theme: 'gray',
  paddingVertical: 0,
  padding: 0,
  margin: 0,
  paddingHorizontal: 0,
  width: '100%',
  minHeight: 40,
  backgroundColor: '$backgroundTransparent',
  borderWidth: 0,
  borderBottomColor: '$color5',
  alignItems: 'stretch',
  justifyContent: 'center',
  borderStyle: 'solid',
  flex: 'none',
})

export const TitlebarRow = styled(XStack, {
  name: 'TitlebarRow',
  className: 'window-drag',
  paddingRight: '$2',
  flex: 'none',
  flexShrink: 0,
  flexGrow: 0,
})

export const TitlebarSection = styled(XStack, {
  name: 'TitlebarSection',
  className: 'no-window-drag',
  ai: 'center',
  gap: '$2',
  userSelect: 'none',
})

export const TitleText = (props) => (
  <SizableText
    name="TitlebarH1"
    size="sm"
    className="max-w-full m-0 overflow-hidden font-bold rounded-sm cursor-default whitespace-nowrap text-ellipsis text-foreground"
    {...props}
  />
)

//   whiteSpace: 'nowrap',
//   maxWidth: '100%',
//   overflow: 'hidden',
//   textOverflow: 'ellipsis',
//   name: 'TitlebarH1',
//   color: '$color12',
//   fontSize: '$4',
//   userSelect: 'none',
//   cursor: 'default',
//   margin: 0,
//   textTransform: 'none',
//   padding: '$1',
//   borderRadius: '$1',
// })

export const TitleTextButton = styled(ButtonText, {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  overflow: 'hidden',
  fontWeight: 'bold',
  textOverflow: 'ellipsis',
  name: 'TitlebarLink',
  color: '$color12',
  fontSize: '$4',
  userSelect: 'none',
  padding: 0,
  margin: 0,
  textTransform: 'none',
  hoverStyle: {
    textDecorationLine: 'underline',
    textDecorationColor: 'currentColor',
    cursor: 'default',
  },
})
