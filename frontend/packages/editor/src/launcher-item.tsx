import {Timestamp} from '@bufbuild/protobuf'
import {getDocumentTitle, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {highlightSearchMatch, useCollapsedPath} from '@shm/ui/search'
import {SizableText} from '@shm/ui/text'
import {useLayoutEffect, useRef} from 'react'
import {XStack, YStack} from 'tamagui'
import {getDaemonFileUrl} from '../../ui/src/get-file-url'

export type SwitcherItem = {
  id?: UnpackedHypermediaId
  key: string
  title: string
  subtitle?: string
  icon?: string
  path?: string[] | null
  versionTime?: Timestamp | undefined
  searchQuery?: string | undefined
  onSelect: () => void
}

export function LauncherItem({
  item,
  selected = false,
  onFocus,
  onMouseEnter,
}: {
  item: SwitcherItem
  selected: boolean
  onFocus: any
  onMouseEnter: any
}) {
  const elm = useRef<HTMLDivElement>(null)
  const collapsedPath = useCollapsedPath(item.path ?? [], elm)

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  return (
    <YStack paddingVertical="$1" ref={elm}>
      <Button
        key={item.key}
        onPress={() => {
          item.onSelect()
        }}
        backgroundColor={selected ? '$brand4' : undefined}
        hoverStyle={{
          backgroundColor: selected ? '$brand4' : undefined,
        }}
        onFocus={onFocus}
        onMouseEnter={onMouseEnter}
      >
        <XStack
          flex={1}
          gap="$3"
          justifyContent="flex-start"
          alignItems="center"
        >
          {item.icon ? (
            <UIAvatar
              label={item.title}
              size={20}
              id={item.key}
              url={getDaemonFileUrl(item.icon)}
            />
          ) : item.path?.length === 0 ? (
            <UIAvatar label={item.title} size={20} id={item.key} />
          ) : null}
          <YStack flex={1} justifyContent="space-between">
            <XStack
              flex={1}
              gap="$3"
              justifyContent="flex-start"
              alignItems="center"
            >
              <SizableText className="truncate" weight="semibold">
                {highlightSearchMatch(item.title, item.searchQuery, {
                  fontWeight: 600,
                })}
              </SizableText>
              <YStack
                flex={1}
                justifyContent="flex-start"
                alignItems="flex-end"
              >
                <SizableText
                  className="truncate"
                  weight="normal"
                  size="sm"
                  color={unpackHmId(item.key)?.latest ? 'success' : 'default'}
                >
                  {unpackHmId(item.key)?.latest
                    ? 'Latest Version'
                    : item.versionTime
                    ? item.versionTime + ' Version'
                    : ''}
                </SizableText>
              </YStack>
            </XStack>

            {!!item.path ? (
              <SizableText className="truncate" weight="normal" size="md">
                {collapsedPath.join(' / ')}
              </SizableText>
            ) : null}
            {/* <SizableText color="$color10">{item.subtitle}</SizableText> */}
          </YStack>
        </XStack>
      </Button>
    </YStack>
  )
}

export function RecentLauncherItem({
  item,
  selected,
  onFocus,
  onMouseEnter,
}: {
  item: {
    key: string
    title: string
    subtitle?: string
    path: string[]
    icon?: string
    id?: UnpackedHypermediaId
    onSelect: () => void
    onFocus?: () => void
    onMouseEnter?: () => void
  }
  selected: boolean
  onFocus: () => void
  onMouseEnter: () => void
}) {
  let path = normalizePath(item.path.slice(0, -1))
  if (item.id) {
    const homeId = `hm://${item.id.uid}`
    const unpacked = unpackHmId(homeId)
    const homeEntity = useEntity(unpacked!)
    const homeTitle = getDocumentTitle(homeEntity.data?.document)

    if (homeTitle && homeTitle !== item.title) {
      path = [homeTitle, ...path]
    }
  }

  return (
    <LauncherItem
      item={{
        ...item,
        path,
      }}
      selected={selected}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
    />
  )
}

function normalizePath(path: string[]): string[] {
  return path.map((segment) => {
    const [first, ...rest] = segment.split('-')
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
  })
}
