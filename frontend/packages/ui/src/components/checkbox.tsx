import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import {cva, VariantProps} from 'class-variance-authority'
import {CheckIcon} from 'lucide-react'
import * as React from 'react'
import {HTMLAttributes} from 'react'
import {cn} from '../utils'
import {Label} from './label'

const checkboxVariants = cva(
  'peer ring ring-px ring-border bg-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary',
        brand:
          'data-[state=checked]:bg-brand-5 data-[state=checked]:text-white dark:data-[state=checked]:bg-brand-5 data-[state=checked]:border-brand-5',
        destructive:
          'data-[state=checked]:bg-destructive data-[state=checked]:text-destructive-foreground dark:data-[state=checked]:bg-destructive data-[state=checked]:border-destructive',
        secondary:
          'data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground dark:data-[state=checked]:bg-secondary data-[state=checked]:border-secondary',
        accent:
          'data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground dark:data-[state=checked]:bg-accent data-[state=checked]:border-accent',
      },
      size: {
        default: 'size-4',
        sm: 'size-3',
        lg: 'size-5',
      },
    },
    defaultVariants: {
      variant: 'brand',
      size: 'default',
    },
  },
)

export function Checkbox({
  className,
  variant = 'brand',
  ...props
}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(checkboxVariants({variant}), className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export type CheckboxProps = React.ComponentProps<
  typeof CheckboxPrimitive.Root
> &
  VariantProps<typeof checkboxVariants>

export function CheckboxField({
  checked,
  onCheckedChange,
  labelProps,
  children,
  id,
  className,
  variant = 'primary',
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  labelProps?: React.LabelHTMLAttributes<HTMLLabelElement>
  children: React.ReactNode | string
  id: string
} & HTMLAttributes<HTMLDivElement> &
  CheckboxProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Checkbox
        checked={checked}
        onCheckedChange={onCheckedChange}
        variant={variant}
      />
      <Label htmlFor={id} {...labelProps}>
        {children}
      </Label>
    </div>
  )
}
