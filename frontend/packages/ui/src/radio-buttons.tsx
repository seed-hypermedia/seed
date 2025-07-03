import {Button} from '@tamagui/button'
import {ColorTokens, SizeTokens} from '@tamagui/core'
import {ComponentProps} from 'react'

export function RadioButtons<
  Options extends ReadonlyArray<{
    key: string
    label: string
    icon?: ComponentProps<typeof Button>['icon'] | undefined
  }>,
>({
  size = '$4',
  color = '$color10',
  activeColor = '$color12',
  options,
  value,
  onValue,
}: {
  size?: SizeTokens
  color?: ColorTokens
  activeColor?: ColorTokens
  options: Options
  value: Options[number]['key']
  onValue: (value: Options[number]['key']) => void
}) {
  return (
    <div className="flex">
      {options.map((option) => (
        <RadioButton
          color={color}
          activeColor={activeColor}
          size={size}
          key={option.key}
          label={option.label}
          icon={option.icon}
          active={value === option.key}
          onPress={() => {
            onValue(option.key)
          }}
        />
      ))}
    </div>
  )
}

function RadioButton({
  label,
  icon,
  active,
  onPress,
  size,
  color,
  activeColor,
}: {
  size?: SizeTokens
  color?: ColorTokens
  activeColor?: ColorTokens
  label: string
  icon: ComponentProps<typeof Button>['icon'] | undefined
  active: boolean
  onPress: () => void
}) {
  return (
    <div>
      <Button
        size={size}
        disabled={active}
        icon={icon}
        chromeless
        backgroundColor="$colorTransparent"
        fontWeight="bold"
        hoverStyle={{
          cursor: 'default',
        }}
        cursor="default"
        borderBottomWidth={2}
        borderBottomColor={active ? activeColor : '$colorTransparent'}
        onPress={onPress}
        borderRadius={0}
      >
        {label}
      </Button>
    </div>
  )
}
