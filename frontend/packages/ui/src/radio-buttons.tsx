import {Button, ButtonProps} from './button'
import {cn} from './utils'

export function RadioButtons<
  Options extends ReadonlyArray<{
    key: string
    label: string
  }>,
>({
  options,
  value,
  onValue,
}: {
  options: Options
  value: Options[number]['key']
  onValue: (value: Options[number]['key']) => void
}) {
  return (
    <div className="flex">
      {options.map((option) => (
        <RadioButton
          key={option.key}
          label={option.label}
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
}: {
  size?: ButtonProps['size']
  activeColor?: string
  label: string
  icon?: React.ReactNode
  active: boolean
  onPress: () => void
}) {
  return (
    <div>
      <Button
        size={size}
        disabled={!active}
        className={cn(
          'rounded-none border-b-2 border-b-transparent font-bold',
          active && 'border-b-current',
        )}
        onClick={onPress}
      >
        {icon}
        {label}
      </Button>
    </div>
  )
}
