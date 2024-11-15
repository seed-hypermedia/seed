import {Check, ChevronDown, ChevronUp} from "@tamagui/lucide-icons";
import {ReactNode} from "react";
import {Select, SizableText, SizeTokens, XStack, YStack} from "tamagui";

export function SelectDropdown<
  Options extends {label: string; value: string; icon?: ReactNode}[],
>({
  options,
  value,
  onValue,
  size,
  placeholder = "Select...",
  width = 140,
}: {
  options: Options;
  value: Options[number]["value"];
  onValue: (value: Options[number]["value"]) => void;
  size?: SizeTokens;
  placeholder?: string;
  width?: number;
}) {
  const selectedOption = options.find((option) => option.value === value);
  return (
    <Select
      value={value}
      size={size}
      onValueChange={onValue}
      disablePreventBodyScroll
    >
      <Select.Trigger size={size} width={width} iconAfter={ChevronDown}>
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

      <Select.Content zIndex="$zIndex.6">
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
            );
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
  );
}
