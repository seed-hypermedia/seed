import {Timestamp} from '@bufbuild/protobuf'
import {useHover} from '@shm/shared/use-hover'
import {formattedDate, formattedDateLong} from '@shm/shared/utils/date'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Tooltip} from '@shm/ui/tooltip'
import {Link} from '@tamagui/lucide-icons'
import {ComponentProps, ReactElement, useState} from 'react'
import {Button, ButtonProps, ButtonText, XStack} from 'tamagui'

export function ListItem({
  accessory,
  title,
  onPress,
  icon,
  onPointerEnter,
  menuItems = [],
  theme,
  backgroundColor,
}: {
  accessory?: ReactElement
  icon?: ReactElement
  title: string
  onPress: ButtonProps['onPress'] | ComponentProps<typeof ButtonText>['onPress']
  onPointerEnter?: () => void
  menuItems?: (MenuItemType | null)[] | (() => (MenuItemType | null)[])
  theme?: ComponentProps<typeof Button>['theme']
  backgroundColor?: ComponentProps<typeof Button>['backgroundColor']
}) {
  let {hover, ...hoverProps} = useHover()
  const [currentMenuItems, setMenuItems] = useState(
    typeof menuItems === 'function' ? undefined : menuItems,
  )
  return (
    <XStack paddingVertical="$1.5" w="100%" maxWidth={900} group="item">
      <Button
        theme={theme}
        backgroundColor={backgroundColor}
        onPointerEnter={() => {
          onPointerEnter?.()
          if (!currentMenuItems && typeof menuItems === 'function') {
            setMenuItems(menuItems())
          }
        }}
        chromeless
        onPress={onPress}
        {...hoverProps}
        maxWidth={600}
        f={1}
        width="100%"
        hoverStyle={{
          bg: '$backgroundFocus',
          borderColor: '$background',
        }}
      >
        {icon}
        <ButtonText
          onPress={(e: MouseEvent) => {
            e.stopPropagation()
            onPress?.(e)
          }}
          fontWeight="700"
          flex={2}
          textAlign="left"
        >
          {title}
        </ButtonText>
        {accessory && (
          <XStack flexShrink={0} gap="$2" paddingHorizontal="$2">
            {accessory}
          </XStack>
        )}
        {currentMenuItems && currentMenuItems.length ? (
          <XStack opacity={hover ? 1 : 0} $group-item-hover={{opacity: 1}}>
            <OptionsDropdown hover={hover} menuItems={currentMenuItems} />
          </XStack>
        ) : (
          <XStack width={20} />
        )}
      </Button>
    </XStack>
  )
}

export function copyLinkMenuItem(
  onPress: () => void,
  label: string,
): MenuItemType | null {
  return {
    onPress,
    key: 'copy-link',
    label: `Copy Link to ${label}`,
    icon: Link,
  }
}

export function TimeAccessory({
  time,
  onPress,
  tooltipLabel,
}: {
  time: Timestamp | undefined
  onPress: (e: MouseEvent) => void
  tooltipLabel?: string
}) {
  return (
    <Tooltip
      content={
        tooltipLabel
          ? `${tooltipLabel} ${formattedDateLong(time)}`
          : formattedDateLong(time)
      }
    >
      <ButtonText
        fontFamily="$body"
        fontSize="$2"
        data-testid="list-item-date"
        onPress={onPress}
        // alignSelf="flex-end"
        minWidth={40}
        justifyContent="flex-end"
      >
        {time ? formattedDate(time) : '...'}
      </ButtonText>
    </Tooltip>
  )
}
