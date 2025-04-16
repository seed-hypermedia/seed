import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {useCollapsedPath} from '@shm/ui/search-input'
import {useLayoutEffect, useRef} from 'react'
import {SizableText, XStack, YStack} from 'tamagui'
import {getDaemonFileUrl} from '../../ui/src/get-file-url'

export type SwitcherItem = {
  key: string
  title: string
  subtitle?: string
  icon?: string
  path?: string[] | null
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
          ) : item.path?.length === 1 ? (
            <UIAvatar label={item.title} size={20} id={item.key} />
          ) : null}
          <YStack flex={1} justifyContent="space-between">
            <SizableText numberOfLines={1} fontWeight={600}>
              {item.title}
            </SizableText>
            {!!item.path ? (
              <SizableText numberOfLines={1} fontWeight={300} fontSize="$3">
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
