import {cn} from '@shm/ui/utils'
import {ReactNode} from 'react'

interface ContainerProps {
  children: ReactNode
  hide?: boolean
  clearVerticalSpace?: boolean
  className?: string
}

export const Container = ({
  children,
  hide = false,
  clearVerticalSpace = false,
  className,
}: ContainerProps) => {
  return (
    <div
      className={cn(
        'mx-auto px-4 pt-6 w-full max-w-[80ch] flex-shrink-0 flex flex-col',
        hide && 'pointer-events-none opacity-0',
        clearVerticalSpace && 'py-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
