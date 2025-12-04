import {Button} from '@shm/ui/button'
import {NodeViewProps} from '@tiptap/core'
import {NodeViewContent} from '@tiptap/react'
import {Check, ChevronDown} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

export const CodeBlockView = ({
  props,
  languages,
}: {
  props: NodeViewProps
  languages: string[]
}) => {
  const {node, updateAttributes} = props
  const [hovered, setHovered] = useState(false)
  const [language, setLanguage] = useState(
    node.attrs.language ? node.attrs.language : 'plaintext',
  )
  const [open, setOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({top: 0, left: 0})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false)
      setHovered(false)
    }, 120)
  }

  useEffect(() => {
    return () => cancelClose()
  }, [])

  const handleChange = (newLanguage: string) => {
    updateAttributes({language: newLanguage})
    setLanguage(newLanguage)
    setOpen(false)
  }

  const handleToggleDropdown = (e?: React.MouseEvent<HTMLButtonElement>) => {
    const isOpening = !open

    // When opening dropdown, calculate position from event target or ref
    if (isOpening) {
      const buttonElement =
        (e?.currentTarget as HTMLElement) || buttonRef.current
      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + 3,
          left: rect.left,
        })
      } else {
        // Use requestAnimationFrame to wait for DOM
        requestAnimationFrame(() => {
          const buttonElement = buttonRef.current
          if (buttonElement) {
            const rect = buttonElement.getBoundingClientRect()
            setDropdownPosition({
              top: rect.bottom + 5,
              left: rect.left,
            })
          }
        })
      }
    }

    setOpen(isOpening)
  }

  // Update position when button moves on horizontal scroll
  useEffect(() => {
    if (!open || !buttonRef.current) return

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setDropdownPosition({
          top: rect.bottom + 5,
          left: rect.left,
        })
      }
    }

    // Update on scroll/resize
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open])

  return (
    <div
      className="relative flex min-w-0 flex-col overflow-hidden"
      onMouseEnter={() => {
        cancelClose()
        setHovered(true)
      }}
      onMouseLeave={() => {
        if (open) {
          scheduleClose()
        } else {
          setHovered(false)
        }
      }}
    >
      {/* Show language button on hover or when dropdown is open */}
      {(hovered || open) && (
        <div
          className="code-block-language-dropdown pointer-events-auto absolute top-1 right-4 z-50 flex w-[150px] items-center gap-4 p-1"
          contentEditable={false}
        >
          <div className="relative w-full">
            <Button
              ref={buttonRef}
              className="border-input bg-background flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-sm shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleToggleDropdown(e)
              }}
              type="button"
            >
              <span className="truncate">{language || 'plaintext'}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </div>
        </div>
      )}

      {/* Portaled dropdown list */}
      {open ? (
        <>
          {createPortal(
            <div
              className="border-muted bg-popover hide-scrollbar absolute z-[9999] mt-1 w-[150px] overflow-y-auto rounded-md border p-1 shadow-md"
              style={{
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                maxHeight: '60vh',
              }}
              onMouseEnter={() => cancelClose()}
              onMouseLeave={() => scheduleClose()}
              onMouseDown={(e) => {
                // Don't blur editor when clicking options
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {languages.map((item) => (
                <Button
                  key={item}
                  onClick={() => handleChange(item)}
                  className="hover:bg-accent dark:hover:bg-accent flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm"
                >
                  <span className="truncate">{item}</span>
                  {language === item && (
                    <Check className="text-primary h-4 w-4" />
                  )}
                </Button>
              ))}
            </div>,
            document.body,
          )}
        </>
      ) : null}

      <div className="relative w-full max-w-full touch-pan-x touch-pan-y overflow-x-auto overflow-y-auto overscroll-x-contain">
        <pre className="m-0 rounded-md bg-transparent px-3 py-3">
          <code className={`hljs language-${language} block`}>
            <div
              className="inline-block min-w-full pr-6"
              style={{whiteSpace: 'pre'}}
            >
              <NodeViewContent style={{whiteSpace: 'pre'}} />
            </div>
          </code>
        </pre>
      </div>
    </div>
  )
}
