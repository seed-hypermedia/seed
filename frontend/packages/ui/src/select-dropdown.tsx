import {Check, ChevronDown, ChevronUp} from '@shm/ui/icons'
import {ComponentProps, ReactNode} from 'react'
import {
  Select,
  SizableText,
  SizeTokens,
  XStack,
  XStackProps,
  YStack,
} from 'tamagui'

export type SelectOptions = Array<{
  label: string
  value: string
  icon?: ReactNode
}>

export type SelectDropdownProps<Options extends SelectOptions> = {
  options: Options
  value: Options[number]['value']
  onValue: (value: Options[number]['value']) => void
  size?: SizeTokens
  placeholder?: string
  width?: XStackProps['width']
  triggerProps?: ComponentProps<typeof Select.Trigger>
}

export function SelectDropdown<Options extends SelectOptions>({
  options,
  value,
  onValue,
  size,
  placeholder = 'Select...',
  width = 140,
  triggerProps,
}: SelectDropdownProps<Options>) {
  const selectedOption = options.find((option) => option.value === value)

  return (
    <Select
      value={value}
      size={size}
      onValueChange={onValue}
      disablePreventBodyScroll
    >
      <Select.Trigger
        size={size}
        width={width}
        f={1}
        iconAfter={ChevronDown}
        borderRadius="$3"
        borderWidth={1}
        borderColor="$borderColor"
        {...triggerProps}
      >
        <XStack gap="$2" ai="center" w="100%">
          {selectedOption ? (
            <>
              {selectedOption.icon}
              <XStack f={1}>
                <SizableText
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                  overflow="hidden"
                >
                  {selectedOption.label}
                </SizableText>
              </XStack>
              <ChevronDown size={16} />
            </>
          ) : (
            <SizableText
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {placeholder}
            </SizableText>
          )}
        </XStack>
      </Select.Trigger>
      <Select.Content
        // @horacio will fix this to use tokens. make sure the dropdown still works in dialog boxes
        zIndex={100_000}
      >
        <Select.ScrollUpButton
          alignItems="center"
          justifyContent="center"
          position="relative"
          width="100%"
          height="$3"
        >
          <YStack zIndex="$zIndex.1">
            <ChevronUp size={20} />
          </YStack>
        </Select.ScrollUpButton>

        <Select.Viewport
          // to do animations:
          // animation="quick"
          // animateOnly={['transform', 'opacity']}
          // enterStyle={{ o: 0, y: -10 }}
          // exitStyle={{ o: 0, y: 10 }}
          minWidth={200}
        >
          {/* for longer lists memoizing these is useful */}
          {options.map((item, i) => {
            return (
              <Select.Item index={i} key={item.value} value={item.value}>
                <XStack gap="$2" ai="center">
                  {item.icon}
                  <Select.ItemText>{item.label}</Select.ItemText>
                </XStack>
                <Select.ItemIndicator marginLeft="auto">
                  <Check size={16} />
                </Select.ItemIndicator>
              </Select.Item>
            )
          })}
        </Select.Viewport>

        <Select.ScrollDownButton
          alignItems="center"
          justifyContent="center"
          position="relative"
          width="100%"
          height="$3"
        >
          <YStack zIndex="$zIndex.1">
            <ChevronDown size={20} />
          </YStack>
        </Select.ScrollDownButton>
      </Select.Content>
    </Select>
  )
}
