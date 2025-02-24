import {Button} from '@shm/ui/button'
import {useLayoutEffect, useRef} from 'react'
import {SizableText, XStack} from 'tamagui'

export type SwitcherItem = {
  key: string
  title: string
  subtitle?: string
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
      <XStack f={1} justifyContent="space-between">
        <SizableText numberOfLines={1}>{item.title}</SizableText>

        <SizableText color="$color10">{item.subtitle}</SizableText>
      </XStack>
    </Button>
  )
}
