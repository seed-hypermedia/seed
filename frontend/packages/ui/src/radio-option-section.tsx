import React from 'react'
import {Label, YStack} from 'tamagui'
import {RadioGroup, RadioGroupItem} from './components/radio-group'
import {SizableText} from './text'

type RadioOption = {
  value: string
  label: string
}
type RadioOptions = ReadonlyArray<RadioOption>

export function RadioOptionSection<Options extends RadioOptions>({
  options,
  value,
  onValue,
  title,
}: {
  options: Options
  value: Options[number]['value']
  onValue: (value: Options[number]['value']) => void
  title: string
}) {
  const id = React.useId()
  return (
    <YStack
      backgroundColor={'$color1'}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$3"
      padding="$4"
      gap="$3"
    >
      <SizableText weight="bold">{title}</SizableText>
      <RadioGroup value={value} onValueChange={onValue}>
        {options.map((option) => {
          return (
            <div className="flex gap-2 items-center" key={option.value}>
              <RadioGroupItem
                value={option.value}
                id={`${id}-${option.value}`}
              />

              <Label size="$2" htmlFor={`${id}-${option.value}`}>
                {option.label}
              </Label>
            </div>
          )
        })}
      </RadioGroup>
    </YStack>
  )
}
