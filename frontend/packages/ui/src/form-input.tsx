import {Check} from '@shm/ui/icons'
import {useId} from 'react'
import {
  Control,
  FieldErrors,
  FieldValues,
  Path,
  useController,
} from 'react-hook-form'
import {Checkbox, Input, Label, Text, TextArea, XStack} from 'tamagui'

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
    <FullCheckbox
      value={c.field.value}
      label={label}
      onValue={c.field.onChange}
      {...props}
    />
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
  ...props
}: {
  value: boolean
  onValue: (value: boolean) => void
  isLoading?: boolean
  label: string
} & React.ComponentProps<typeof XStack>) {
  const id = useId()
  return (
    <XStack gap="$2" {...props}>
      <Checkbox
        checked={value}
        onCheckedChange={onValue}
        opacity={isLoading ? 0.5 : 1}
        id={id}
      >
        <Checkbox.Indicator>
          <Check color="$brand5" />
        </Checkbox.Indicator>
      </Checkbox>
      <Label lineHeight={0} htmlFor={id}>
        {label}
      </Label>
    </XStack>
  )
}
