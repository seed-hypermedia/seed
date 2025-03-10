import {ComponentProps, PropsWithChildren} from 'react'
import {FieldErrors, FieldValues} from 'react-hook-form'
import {Fieldset, Label, SizableText, XStack} from 'tamagui'

export function FormErrors<Fields extends FieldValues>({
  errors,
}: {
  errors: FieldErrors<Fields>
}) {
  if (errors.root) {
    return <SizableText color="$red10">{errors.root.message}</SizableText>
  }
  return null
}

export function FormField<Fields extends FieldValues>({
  name,
  label,
  errors,
  children,
  ...props
}: PropsWithChildren<
  {
    name: keyof Fields
    errors: FieldErrors<Fields>
    label?: string
  } & ComponentProps<typeof Fieldset>
>) {
  return (
    <Fieldset borderColor="transparent" {...props}>
      <XStack ai="center" justifyContent="space-between">
        {label ? (
          <Label
            htmlFor={String(name)}
            lineHeight="$4"
            marginBottom="$2"
            color={errors[name]?.message ? '$red10' : undefined}
          >
            {label}
          </Label>
        ) : null}
        <SizableText color="$red10">{errors[name]?.message}</SizableText>
      </XStack>
      {children}
    </Fieldset>
  )
}
