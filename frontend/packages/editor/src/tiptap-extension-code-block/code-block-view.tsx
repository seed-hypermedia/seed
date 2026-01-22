import {Button} from '@shm/ui/button'
import {NodeViewProps} from '@tiptap/core'
import {NodeViewContent} from '@tiptap/react'
import mermaid from 'mermaid'
import {Check, ChevronDown, Eye, EyeOff, GitBranch} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
})

export const CodeBlockView = ({
  props,
  languages,
  onConvertToMermaidBlock,
}: {
  props: NodeViewProps
  languages: string[]
  onConvertToMermaidBlock?: (content: string) => void
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
  const [showMermaidPreview, setShowMermaidPreview] = useState(false)
  const [mermaidSvg, setMermaidSvg] = useState<string>('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)

  const isMermaid = language === 'mermaid'
  const codeContent = node.textContent || ''

  // Ensure mermaid is in the languages list
  const allLanguages = languages.includes('mermaid')
    ? languages
    : [...languages, 'mermaid'].sort((a, b) => a.localeCompare(b))

  const renderMermaid = useCallback(async () => {
    if (!isMermaid || !codeContent.trim()) {
      setMermaidSvg('')
      setMermaidError(null)
      return
    }

    try {
      const id = `mermaid-preview-${Date.now()}`
      const {svg} = await mermaid.render(id, codeContent)
      setMermaidSvg(svg)
      setMermaidError(null)
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid diagram'
      setMermaidError(errorMessage)
      setMermaidSvg('')
    }
  }, [isMermaid, codeContent])

  useEffect(() => {
    if (showMermaidPreview && isMermaid) {
      renderMermaid()
    }
  }, [showMermaidPreview, isMermaid, renderMermaid])

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
    // Reset mermaid preview when language changes
    if (newLanguage !== 'mermaid') {
      setShowMermaidPreview(false)
      setMermaidSvg('')
      setMermaidError(null)
    }
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

  const handleConvertToMermaid = () => {
    if (onConvertToMermaidBlock && codeContent) {
      onConvertToMermaidBlock(codeContent)
    }
  }

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
          className="code-block-language-dropdown pointer-events-auto absolute top-1 right-4 z-50 flex items-center gap-2 p-1"
          contentEditable={false}
        >
          {/* Mermaid-specific buttons */}
          {isMermaid && (
            <>
              <Button
                className="border-input bg-background flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setShowMermaidPreview(!showMermaidPreview)
                }}
                type="button"
                title={showMermaidPreview ? 'Hide Preview' : 'Preview Diagram'}
              >
                {showMermaidPreview ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
                <span>{showMermaidPreview ? 'Hide' : 'Preview'}</span>
              </Button>
              {onConvertToMermaidBlock && (
                <Button
                  className="border-input bg-background flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleConvertToMermaid()
                  }}
                  type="button"
                  title="Convert to Mermaid Block"
                >
                  <GitBranch className="h-3 w-3" />
                  <span>To Block</span>
                </Button>
              )}
            </>
          )}
          <div className="relative w-[120px]">
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
              {allLanguages.map((item) => (
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

      {/* Mermaid preview area */}
      {isMermaid && showMermaidPreview && (
        <div
          className="border-border bg-muted/30 mb-2 rounded-md border p-3"
          contentEditable={false}
        >
          {mermaidError ? (
            <div className="rounded-md bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <p className="font-mono text-sm">Error: {mermaidError}</p>
            </div>
          ) : mermaidSvg ? (
            <div
              className="flex w-full items-center justify-center overflow-auto"
              dangerouslySetInnerHTML={{__html: mermaidSvg}}
            />
          ) : (
            <p className="text-muted-foreground text-center text-sm">
              Enter diagram code to preview
            </p>
          )}
        </div>
      )}

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
