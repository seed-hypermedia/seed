import {dispatchScroll} from '@/editor/editor-on-scroll-stream'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {HTMLAttributes} from 'react'

export function MainWrapper({
  children,
  scrollable = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {scrollable?: boolean}) {
  return (
    <div {...props} className={`flex flex-1 h-full w-full ${className || ''}`}>
      {/* TODO: we cannot remove this ID here because the SlashMenu is referencing
      this! */}
      <div className="flex-1 h-full">
        {scrollable ? (
          <ScrollArea
            id="scroll-page-wrapper"
            onScroll={() => {
              dispatchScroll('scroll')
            }}
          >
            {children}
          </ScrollArea>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

export function MainWrapperStandalone({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-1 ${className || ''}`} {...props}>
      {/* TODO: we cannot remove this ID here because the SlashMenu is referencing
      this! */}
      <ScrollArea
        id="scroll-page-wrapper"
        onScroll={() => {
          dispatchScroll('scroll')
        }}
      >
        {children}
      </ScrollArea>
    </div>
  )
}

export function MainWrapperNoScroll({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-1 ${className || ''}`} {...props}>
      {children}
    </div>
  )
}
