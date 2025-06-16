import {cn} from './utils'

interface FooterWrapperProps {
  children?: React.ReactNode
  className?: string
}

export function FooterWrapper({children, className}: FooterWrapperProps) {
  return (
    <div
      className={cn(
        '-mx-1 py-0 flex w-full border border-transparent',
        'items-center flex-none min-h-6 select-none',
        className,
      )}
    >
      {children}
    </div>
  )
}
