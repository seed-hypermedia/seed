import {cn} from './utils'

interface FooterWrapperProps {
  children?: React.ReactNode
  className?: string
}

export function FooterWrapper({children, className}: FooterWrapperProps) {
  return (
    <div
      className={cn(
        '-mx-1 flex w-full border border-transparent py-0',
        'min-h-6 flex-none items-center select-none',
        className,
      )}
    >
      {children}
    </div>
  )
}
