import {SizableText} from './text'
import {PropsWithChildren} from 'react'
import {FieldErrors, FieldValues} from 'react-hook-form'
import {Label} from './components/label'
import {cn} from './utils'

export function FormErrors<Fields extends FieldValues>({
  errors,
}: {
  errors: FieldErrors<Fields>
}) {
  if (errors.root) {
    return <SizableText color="destructive">{errors.root.message}</SizableText>
  }
  return null
}

export function FormField<Fields extends FieldValues>({
  name,
  label,
  errors,
  children,
  width,
  className,
}: PropsWithChildren<
  React.HTMLAttributes<HTMLFieldSetElement> & {
    name: keyof Fields
    errors?: FieldErrors<Fields>
    label?: string
    width?: number | string
  }
>) {
  return (
    <div
      className={cn(
        'w-full',
        width && `w-[${typeof width == 'number' ? `${width}px` : width}]`,
        className,
      )}
    >
      <div className="flex items-center justify-between">
        {label ? (
          <Label
            htmlFor={String(name)}
            className={cn(
              'mb-2',
              errors && errors[name]?.message && 'text-red-500',
            )}
          >
            {label}
          </Label>
        ) : null}
        {errors && errors[name]?.message ? (
          <SizableText color="destructive">
            {errors[name]?.message as string}
          </SizableText>
        ) : null}
      </div>
      {children}
    </div>
  )
}
