import {CheckedState} from '@radix-ui/react-checkbox'
import {useId} from 'react'
import {
  Control,
  FieldErrors,
  FieldValues,
  Path,
  useController,
} from 'react-hook-form'
import {Input, Text, TextArea} from 'tamagui'
import {Checkbox, CheckboxProps} from './components/checkbox'
import {Label} from './components/label'

export function FormInput<Fields extends FieldValues>({
  control,
  name,
  transformInput,
  ...props
}: React.ComponentProps<typeof Input> & {
  control: Control<Fields>
  name: Path<Fields>
  transformInput?: (input: string) => string
}) {
  const c = useController({control, name})
  const {onChange, ...inputProps} = c.field
  return (
    <Input
      {...inputProps}
      id={name}
      onChangeText={(text) => {
        if (transformInput) {
          onChange(transformInput(text))
        } else {
          onChange(text)
        }
      }}
      {...props}
    />
  )
}

export function FormCheckbox<Fields extends FieldValues>({
  control,
  name,
  label,
  ...props
}: React.ComponentProps<typeof Checkbox> & {
  control: Control<Fields>
  name: Path<Fields>
  label: string
}) {
  const c = useController({control, name})
  return (
    <div className="flex gap-1">
      <FullCheckbox
        value={c.field.value as CheckedState}
        label={label}
        onValue={c.field.onChange}
        {...props}
      />
    </div>
  )
}

export function FormTextArea<Fields extends FieldValues>({
  control,
  name,
  ...props
}: React.ComponentProps<typeof TextArea> & {
  control: Control<Fields>
  name: Path<Fields>
}) {
  const c = useController({control, name})
  return <TextArea {...c.field} {...props} />
}

export function FormError<TFieldValues extends Record<string, string>>({
  errors,
  name,
}: {
  errors?: FieldErrors<TFieldValues> | undefined
  name: keyof FieldErrors<TFieldValues>
}) {
  const error = errors?.[name]
  if (!error) return null
  return (
    <Text fontFamily="$body" color="$red9">
      {error.message}
    </Text>
  )
}

export function FullCheckbox({
  value,
  onValue,
  isLoading,
  label,
  size = 'default',
}: {
  value: CheckedState
  onValue: (value: CheckedState) => void
  isLoading?: boolean
  label: string
} & CheckboxProps) {
  const id = useId()
  return (
    <div className="flex gap-1">
      <Checkbox
        className={isLoading ? 'opacity-50' : ''}
        checked={value}
        onCheckedChange={onValue}
        id={id}
        size={size}
      />
      <Label htmlFor={id} size={size}>
        {label}
      </Label>
    </div>
  )
}
