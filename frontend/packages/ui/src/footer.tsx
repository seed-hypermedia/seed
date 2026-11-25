import {cn} from './utils'

interface FooterWrapperProps {
  children?: React.ReactNode
  className?: string
}

/** Keeps the app status bar at its fixed height, including when its content changes. */
export function FooterWrapper({children, className}: FooterWrapperProps) {
  return (
    <div
      className={cn(
        '-mx-1 flex w-full border border-transparent py-0',
        'h-6 max-h-6 min-h-0 items-center overflow-hidden select-none',
        className,
      )}
    >
      {children}
    </div>
  )
}
