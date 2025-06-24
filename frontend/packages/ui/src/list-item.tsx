import {Button} from '@tamagui/button'
import {useTheme, View} from '@tamagui/core'
import {ListItem, ListItemProps} from '@tamagui/list-item'
import {ArrowDownRight, ChevronDown, ChevronRight} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
import {
  ComponentProps,
  createElement,
  isValidElement,
  ReactNode,
  useState,
} from 'react'
import {type GestureResponderEvent} from 'react-native'
import {DraftBadge} from './draft-badge'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

export function FocusButton({
  onPress,
  label,
}: {
  onPress: () => void
  label?: string
}) {
  return (
    <Tooltip content={label ? `Focus ${label}` : 'Focus'}>
      <Button
        icon={ArrowDownRight}
        onPress={(e: GestureResponderEvent) => {
          e.stopPropagation()
          onPress()
        }}
        chromeless
        backgroundColor={'$colorTransparent'}
        size="$1"
      />
    </Tooltip>
  )
}

export function SmallCollapsableListItem({
  children,
  ...props
}: ComponentProps<typeof SmallListItem>) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const displayChildren = isCollapsed ? null : children
  return (
    <>
      <SmallListItem
        isCollapsed={isCollapsed}
        onSetCollapsed={setIsCollapsed}
        {...props}
      />
      {displayChildren}
    </>
  )
}

export function SmallListItem({
  disabled,
  title,
  icon,
  iconAfter,
  children,
  indented,
  bold,
  active,
  activeBgColor,
  rightHover,
  color,
  paddingVertical,
  minHeight,
  menuItems,
  isCollapsed,
  onSetCollapsed,
  isDraft,
  multiline = false,
  docId,
  ...props
}: ListItemProps & {
  indented?: boolean | number
  bold?: boolean
  activeBgColor?: ComponentProps<typeof ListItem>['backgroundColor']
  selected?: boolean
  rightHover?: ReactNode[]
  menuItems?: MenuItemType[]
  isCollapsed?: boolean | null
  onSetCollapsed?: (collapsed: boolean) => void
  isDraft?: boolean
  multiline?: boolean
  docId?: string
}) {
  const theme = useTheme()
  const indent = indented ? (typeof indented === 'number' ? indented : 1) : 0
  const activeBg = activeBgColor || '$brand12'
  return (
    <ListItem
      className="mobile-menu-item"
      hoverTheme
      pressTheme
      focusTheme
      minHeight={minHeight || 32}
      paddingVertical={paddingVertical || '$1'}
      size="$3"
      // $gtSm={{size: "$2"}}
      paddingLeft={Math.max(0, indent) * 22 + 12}
      textAlign="left"
      outlineColor="transparent"
      backgroundColor={active ? activeBg : '$colorTransparent'}
      hoverStyle={
        active
          ? {backgroundColor: '$brand11', cursor: 'default'}
          : {backgroundColor: '$color4', cursor: 'default'}
      }
      cursor="default"
      userSelect="none"
      // gap="$2"
      group="item"
      color={color || '$gray12'}
      title={undefined}
      borderRadius="$2"
      iconAfter={
        iconAfter || rightHover || menuItems ? (
          <>
            {rightHover ? (
              <XStack opacity={0} $group-item-hover={{opacity: 1}}>
                {rightHover}
              </XStack>
            ) : null}
            {menuItems ? (
              <OptionsDropdown hiddenUntilItemHover menuItems={menuItems} />
            ) : null}
          </>
        ) : null
      }
      // this data attribute is used by the hypermedia highlight component
      data-docid={docId}
      {...props}
    >
      <XStack gap="$2" jc="center" f={1}>
        {isValidElement(icon) ? (
          icon
        ) : icon ? (
          <View width={18}>
            {createElement(icon, {
              size: 18,
              color: color || theme.gray12.val,
            })}
          </View>
        ) : null}
        {children}
        <XStack f={1} ai="center" gap="$1">
          <SizableText
            size="sm"
            weight={bold ? 'bold' : 'normal'}
            className={` ${isDraft ? 'flex-none' : 'flex-1'} ${
              multiline
                ? 'line-clamp-2'
                : 'truncate overflow-hidden whitespace-nowrap'
            } mobile-menu-item-label w-full select-none`.trim()}
            style={{
              color: typeof color === 'string' ? color : theme.gray12.val,
            }}
          >
            {title}
          </SizableText>
          {isDraft ? <DraftBadge /> : null}
        </XStack>
        {isCollapsed != null ? (
          <Button
            position="absolute"
            left={-24}
            size="$1"
            chromeless
            backgroundColor={'$colorTransparent'}
            onPress={(e: GestureResponderEvent) => {
              e.stopPropagation()
              e.preventDefault()
              onSetCollapsed?.(!isCollapsed)
            }}
            icon={isCollapsed ? ChevronRight : ChevronDown}
          />
        ) : null}
      </XStack>
    </ListItem>
  )
}

export function SmallListGroupItem({
  items,
  defaultExpanded,
  ...props
}: {
  items: ReactNode[]
  defaultExpanded?: boolean
} & ComponentProps<typeof SmallListItem>) {
  const [isCollapsed, setIsCollapsed] = useState(defaultExpanded ? false : true)
  return (
    <>
      <SmallListItem
        {...props}
        isCollapsed={items.length ? isCollapsed : null}
        onSetCollapsed={setIsCollapsed}
      />
      {isCollapsed ? null : items}
    </>
  )
}
