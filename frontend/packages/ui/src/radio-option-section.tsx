import React from 'react'
import {Label} from './components/label'
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
    <div className="bg-background border border-border rounded-lg p-4 flex flex-col gap-3">
      <SizableText weight="bold">{title}</SizableText>
      <RadioGroup value={value} onValueChange={onValue}>
        {options.map((option) => {
          return (
            <div className="flex gap-2 items-center" key={option.value}>
              <RadioGroupItem
                value={option.value}
                id={`${id}-${option.value}`}
              />

              <Label size="sm" htmlFor={`${id}-${option.value}`}>
                {option.label}
              </Label>
            </div>
          )
        })}
      </RadioGroup>
    </div>
  )
}
