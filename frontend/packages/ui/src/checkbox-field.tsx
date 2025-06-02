import {Check} from 'lucide-react'
import React, {HTMLAttributes} from 'react'
import {cn} from './utils'

export function CheckboxField({
  value,
  onValue,
  labelProps,
  children,
  id,
  className,
  ...props
}: {
  value: boolean
  onValue: (value: boolean) => void
  labelProps?: React.LabelHTMLAttributes<HTMLLabelElement>
  children: React.ReactNode | string
  id: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn('flex gap-3 items-center', className)}>
      <div className="relative">
        <input
          type="checkbox"
          id={id}
          checked={typeof value === 'boolean' ? value : false}
          onChange={(e) => onValue(e.target.checked)}
          className={cn(
            'peer appearance-none w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-sm bg-white dark:bg-gray-700',
            'cursor-pointer transition-all duration-200',
            'hover:border-gray-400 dark:hover:border-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-brand dark:focus:ring-brand focus:ring-offset-0',
            'checked:bg-brand checked:border-brand dark:checked:bg-brand dark:checked:border-brand0',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity duration-200 size-[20px]">
          <Check size={14} className="text-white" strokeWidth={3} />
        </div>
      </div>
      <label
        htmlFor={id}
        {...labelProps}
        className={cn(
          'text-gray-700 dark:text-gray-300 cursor-pointer select-none',
          labelProps?.className,
        )}
      >
        {children}
      </label>
    </div>
  )
}
