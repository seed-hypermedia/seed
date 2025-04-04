import {Button} from '@shm/ui/button'
import {useLayoutEffect, useRef} from 'react'
import {SizableText, YStack} from 'tamagui'

export type SwitcherItem = {
  key: string
  title: string
  subtitle?: string
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

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [selected])

  return (
    <Button
      ref={elm}
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
      <YStack flex={1} justifyContent="space-between">
        {/* <SizableText numberOfLines={1}>{item.title}</SizableText> */}
        <SizableText numberOfLines={1} fontWeight={600}>
          {item.title}
        </SizableText>
        {!!item.path ? (
          <SizableText numberOfLines={1} fontWeight={300} fontSize="$3">
            {item.path?.slice(0, -1).join(' / ')}
          </SizableText>
        ) : null}

        {/* <SizableText color="$color10">{item.subtitle}</SizableText> */}
      </YStack>
    </Button>
  )
}
