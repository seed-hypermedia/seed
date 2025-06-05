import {ListItem, ListItemProps} from '@tamagui/list-item'
import {SizableText} from './text'

export function MenuItem({
  disabled,
  title,
  icon,
  iconAfter,
  children,
  ...props
}: ListItemProps) {
  return (
    <ListItem
      hoverTheme
      pressTheme
      focusTheme
      size="$2"
      userSelect="none"
      hoverStyle={{backgroundColor: '$color4', cursor: 'default'}}
      paddingVertical="$2"
      paddingHorizontal="$4"
      textAlign="left"
      outlineColor="transparent"
      bg="$colorTransparent"
      opacity={disabled ? 0.5 : 1}
      cursor={disabled ? 'not-allowed' : 'default'}
      title={
        title ? (
          <SizableText
            size="sm"
            className={`select-none ${
              disabled ? 'cursor-not-allowed' : 'cursor-default'
            }`}
          >
            {title}
          </SizableText>
        ) : undefined
      }
      icon={icon}
      iconAfter={iconAfter}
      {...props}
    >
      {children}
    </ListItem>
  )
}
