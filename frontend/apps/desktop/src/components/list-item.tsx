import {FavoriteButton} from '@/components/favoriting'

import {LibraryData, LibraryDependentData} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {Timestamp} from '@bufbuild/protobuf'
import {getMetadataName} from '@shm/shared/content'
import {DocumentRoute} from '@shm/shared/routes'
import {useHover} from '@shm/shared/use-hover'
import {formattedDate, formattedDateLong} from '@shm/shared/utils/date'
import {Checkbox} from '@shm/ui/components/checkbox'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Tooltip} from '@shm/ui/tooltip'
import {ComponentProps, ReactElement, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
import {
  Button,
  ButtonProps,
  ButtonText,
  SizableText,
  Text,
  XStack,
  YStack,
} from 'tamagui'

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
          onPress={(e: GestureResponderEvent) => {
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
  onPress: (e: GestureResponderEvent) => void
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

export function LibraryListItem({
  entry,
  exportMode,
  selected,
  docId,
  toggleDocumentSelection,
}: {
  entry: LibraryData['items'][number]
  exportMode: boolean
  selected: boolean
  toggleDocumentSelection: (id: string) => void
  docId: string
}) {
  const navigate = useNavigate()
  const metadata = entry.document?.metadata || entry.draft?.metadata
  const isUnpublished = !!entry.draft && !entry.document
  const editors = useMemo(
    () =>
      entry.authors.length > 3 ? entry.authors.slice(0, 2) : entry.authors,
    [entry.authors],
  )

  const icon =
    entry.id.path?.length == 0 || entry.document?.metadata.icon ? (
      <HMIcon
        size={28}
        id={entry.id}
        metadata={entry.document?.metadata || entry.draft?.metadata}
      />
    ) : null

  const hoverColor = '$color5'
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: hoverColor,
      }}
      bg="$colorTransparent"
      elevation="$1"
      paddingHorizontal={16}
      paddingVertical="$1"
      onPress={() => {
        if (!exportMode) {
          navigate({key: 'document', id: entry.id})
        }
        // else {
        //   toggleDocumentSelection(entry.id.id)
        // }
      }}
      h={60}
      icon={
        exportMode ? (
          <XStack ai="center" gap="$3">
            {exportMode && (
              <Checkbox
                checked={selected}
                onCheckedChange={() => {
                  toggleDocumentSelection(entry.id.id)
                }}
              />
            )}

            {icon}
          </XStack>
        ) : (
          icon
        )
      }
      // this data attribute is used by the hypermedia highlight component
      data-docid={docId}
      className="group"
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2" paddingLeft={4}>
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(metadata)}
            </SizableText>
            {isUnpublished && (
              <SizableText
                size="$1"
                color="$yellow11"
                paddingHorizontal="$2"
                paddingVertical="$1"
                bg="$yellow3"
                borderRadius="$1"
                borderColor="$yellow10"
                borderWidth={1}
              >
                Unpublished
              </SizableText>
            )}
          </XStack>
          {entry.location.length ? (
            <LibraryEntryLocation
              location={entry.location}
              onNavigate={navigate}
            />
          ) : null}
        </YStack>
      </XStack>
      <div className="flex items-center gap-3">
        {isUnpublished ? null : (
          <FavoriteButton id={entry.id} hideUntilItemHover />
        )}

        <LibraryEntryTime entry={entry} />

        <XStack>
          {editors.map((author, idx) => (
            <XStack
              zIndex={idx + 1}
              key={author.id.id}
              borderColor="$background"
              backgroundColor="$background"
              $group-item-hover={{
                borderColor: hoverColor,
                backgroundColor: hoverColor,
              }}
              borderWidth={2}
              borderRadius={100}
              overflow="hidden"
              marginLeft={-8}
              animation="fast"
            >
              <LinkIcon
                key={author.id.id}
                id={author.id}
                metadata={author.metadata}
                size={20}
              />
            </XStack>
          ))}
          {entry.authors.length > editors.length && editors.length != 0 ? (
            <XStack
              zIndex="$zIndex.1"
              borderColor="$background"
              backgroundColor="$background"
              borderWidth={2}
              borderRadius={100}
              marginLeft={-8}
              animation="fast"
              width={24}
              height={24}
              ai="center"
              jc="center"
            >
              <Text
                fontSize={10}
                fontFamily="$body"
                fontWeight="bold"
                color="$color10"
              >
                +{entry.authors.length - editors.length - 1}
              </Text>
            </XStack>
          ) : null}
        </XStack>
      </div>
    </Button>
  )
}

function LibraryEntryTime({entry}: {entry: LibraryData['items'][number]}) {
  return (
    <SizableText size="$1" color="$color10">
      {formattedDate(entry.updateTime)}
    </SizableText>
  )
}

function LibraryEntryLocation({
  location,
  onNavigate,
}: {
  location: LibraryDependentData[]
  onNavigate: (route: DocumentRoute) => void
}) {
  const [space, ...names] = location
  return (
    <XStack gap="$2" w="100%" overflow="hidden">
      <Button
        color="$brand5"
        fontWeight="400"
        size="$1"
        borderWidth={0}
        bg="$colorTransparent"
        hoverStyle={{
          color: '$brand6',
          bg: '$colorTransparent',
          textDecorationLine: 'underline',
          textDecorationColor: 'currentColor',
        }}
        onPress={(e: GestureResponderEvent) => {
          e.stopPropagation()
          onNavigate({key: 'document', id: space.id})
        }}
      >
        {getMetadataName(space.metadata)}
      </Button>

      {names.length ? (
        <>
          <SizableText size="$1" color="$color9">
            |
          </SizableText>
          <XStack ai="center" gap="$0.5">
            {names.map(({id, metadata}, idx) => (
              <>
                {idx != 0 ? (
                  <SizableText
                    key={`slash-${id.id}`}
                    color="$color10"
                    size="$1"
                  >
                    /
                  </SizableText>
                ) : null}
                <Button
                  key={id.id}
                  size="$1"
                  borderWidth={0}
                  bg="$colorTransparent"
                  color="$color10"
                  hoverStyle={{
                    bg: '$colorTransparent',
                    textDecorationLine: 'underline',
                    textDecorationColor: 'currentColor',
                  }}
                  onPress={(e: GestureResponderEvent) => {
                    e.stopPropagation()
                    onNavigate({key: 'document', id})
                  }}
                >
                  {metadata
                    ? getMetadataName(metadata)
                    : id.path?.at(-1) || 'Untitled'}
                </Button>
              </>
            ))}
          </XStack>
        </>
      ) : null}
    </XStack>
  )
}
