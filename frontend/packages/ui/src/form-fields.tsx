import {Label} from './components/label'
import {PropsWithChildren} from 'react'
import {Input} from './components/input'
import {Switch, SwitchProps} from './components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select-dropdown'

export function Field({
  id,
  label,
  children,
}: PropsWithChildren<{label: string; id: string}>) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} size="sm" className="text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function TextField({
  label,
  Icon,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  Icon?: any
  id: string
}) {
  let content = (
    <div className="border-border flex items-center gap-2 rounded-sm border px-2">
      {Icon && <Icon className="size-3" size={14} />}
      <Input autoFocus {...props} />
    </div>
  )

  if (label) {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} size="sm" className="text-muted-foreground">
          {label}
        </Label>
        {content}
      </div>
    )
  } else {
    return content
  }
}

export function SelectField({
  label,
  Icon,
  id,
  options,
  value,
  onValue,
  className,
  placeholder,
  ...props
}: {
  label?: string
  Icon?: any
  id: string
  options: Array<{value: string; label: string}>
  value?: string
  onValue?: (value: string) => void
  className?: string
  placeholder?: string
} & React.ComponentProps<typeof Select>) {
  const content = (
    <Select value={value} onValueChange={onValue} {...props}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  if (label) {
    return (
      <div className="flex w-full items-center justify-between gap-2">
        <Label htmlFor={id} size="sm" className="text-muted-foreground">
          {label}
        </Label>
        <div className="w-1/2">{content}</div>
      </div>
    )
  } else {
    return content
  }
}

export function SwitchField({
  label,
  id,
  ...props
}: SwitchProps & {label: string; id: string}) {
  return (
    <div className="flex w-full items-center justify-between">
      <Label htmlFor={id} size="sm" className="text-muted-foreground flex-1">
        {label}
      </Label>
      <Switch {...props} />
    </div>
  )
}
