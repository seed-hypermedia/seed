import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {NodeViewProps} from '@tiptap/core'
import {NodeViewContent} from '@tiptap/react'
import {Check, ChevronDown, Copy, Eye, EyeOff, X} from 'lucide-react'
import mermaid from 'mermaid'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
})

let mermaidRenderId = 0

/** Renders code with copy controls and an optional Mermaid diagram view. */
export const CodeBlockView = ({props, languages}: {props: NodeViewProps; languages: string[]}) => {
  const {node, updateAttributes} = props
  const language = node.attrs.language || 'plaintext'
  const [open, setOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({top: 0, left: 0})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [showMermaidPreview, setShowMermaidPreview] = useState(true)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [mermaidSvg, setMermaidSvg] = useState<string>('')
  const [mermaidError, setMermaidError] = useState<string | null>(null)

  const isMermaid = language === 'mermaid'
  const codeContent = node.textBetween(0, node.content.size, '', '\n')

  // Ensure mermaid is in the languages list
  const allLanguages = languages.includes('mermaid')
    ? languages
    : [...languages, 'mermaid'].sort((a, b) => a.localeCompare(b))

  useEffect(() => {
    setShowMermaidPreview(true)
    setMermaidSvg('')
    setMermaidError(null)
  }, [language])

  useEffect(() => {
    setCopyState('idle')
  }, [codeContent])

  useEffect(() => {
    if (copyState === 'idle') return
    const timeout = setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(timeout)
  }, [copyState])

  useEffect(() => {
    if (!showMermaidPreview || !isMermaid) return
    let cancelled = false
    setMermaidSvg('')
    setMermaidError(null)
    if (!codeContent.trim()) return

    const id = `mermaid-preview-${mermaidRenderId++}`
    mermaid.render(id, codeContent).then(
      ({svg}) => {
        if (!cancelled) setMermaidSvg(svg)
      },
      (error) => {
        document.getElementById(id)?.remove()
        if (!cancelled) setMermaidError(error instanceof Error ? error.message : 'Invalid diagram')
      },
    )
    return () => {
      cancelled = true
    }
  }, [showMermaidPreview, isMermaid, codeContent])

  const copyLabel =
    copyState === 'copied' ? 'Code Copied' : copyState === 'error' ? 'Copy Failed. Try Again' : 'Copy Code'

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
    }, 120)
  }

  useEffect(() => {
    return () => cancelClose()
  }, [])

  const handleChange = (newLanguage: string) => {
    updateAttributes({language: newLanguage})
    setOpen(false)
  }

  const handleToggleDropdown = (e?: React.MouseEvent<HTMLButtonElement>) => {
    const isOpening = !open

    // When opening dropdown, calculate position from event target or ref
    if (isOpening) {
      const buttonElement = (e?.currentTarget as HTMLElement) || buttonRef.current
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
      className="group/code-block relative flex min-w-0 flex-col overflow-hidden"
      onMouseEnter={cancelClose}
      onMouseLeave={() => {
        if (open) scheduleClose()
      }}
    >
      <div
        className="code-block-language-dropdown pointer-events-none absolute top-2 right-2 z-50 flex items-center gap-1 opacity-0 group-hover/code-block:pointer-events-auto group-hover/code-block:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 data-[open=true]:pointer-events-auto data-[open=true]:opacity-100 [@media(any-pointer:coarse)]:pointer-events-auto [@media(any-pointer:coarse)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        contentEditable={false}
        data-open={open}
      >
        {isMermaid && (
          <Button
            size="xs"
            className="border-input bg-background border shadow-sm"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowMermaidPreview(!showMermaidPreview)
            }}
            type="button"
            title={showMermaidPreview ? 'Show Code' : 'Preview Diagram'}
            aria-label={showMermaidPreview ? 'Show Code' : 'Preview Diagram'}
          >
            {showMermaidPreview ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            <span>{showMermaidPreview ? 'Code' : 'Preview'}</span>
          </Button>
        )}
        <Button
          ref={buttonRef}
          size="xs"
          className="border-input bg-background w-24 justify-between border shadow-sm"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleToggleDropdown(e)
          }}
          type="button"
        >
          <span className="truncate">{language}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
        <Tooltip content={copyLabel} asChild>
          <Button
            type="button"
            size="iconSm"
            aria-label={copyLabel}
            className="text-muted-foreground bg-background"
            onMouseDown={(e) => e.preventDefault()}
            onClick={async (e) => {
              e.preventDefault()
              e.stopPropagation()
              try {
                await navigator.clipboard.writeText(codeContent)
                setCopyState('copied')
              } catch {
                setCopyState('error')
              }
            }}
          >
            {copyState === 'copied' ? (
              <Check className="size-3.5" />
            ) : copyState === 'error' ? (
              <X className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </Tooltip>
        <span className="sr-only" role="status">
          {copyState === 'idle' ? '' : copyLabel}
        </span>
      </div>

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
                  {language === item && <Check className="text-primary size-4" />}
                </Button>
              ))}
            </div>,
            document.body,
          )}
        </>
      ) : null}

      {/* Mermaid preview area */}
      {isMermaid && showMermaidPreview && (
        <div className="border-border bg-muted/30 mb-2 rounded-md border p-3 pt-10" contentEditable={false}>
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
              {codeContent.trim() ? 'Rendering diagram…' : 'Enter diagram code to preview'}
            </p>
          )}
        </div>
      )}

      <div hidden={isMermaid && showMermaidPreview} className={isMermaid ? 'pt-8' : undefined}>
        <CodeBlockScroller language={language}>
          <NodeViewContent style={{whiteSpace: 'pre'}} />
        </CodeBlockScroller>
      </div>
    </div>
  )
}

/**
 * The static pre/code chrome of a code block. Shared by the live node view
 * above and the server renderer (ssr-render.tsx) so both emit identical
 * markup.
 */
export function CodeBlockScroller({language, children}: {language: string; children: ReactNode}) {
  return (
    <div className="relative w-full max-w-full touch-pan-x touch-pan-y overflow-x-auto overflow-y-auto overscroll-x-contain">
      <pre className="m-0 rounded-md bg-transparent px-3 py-3">
        <code className={`hljs language-${language} block`}>
          <div className="inline-block min-w-full pr-12" style={{whiteSpace: 'pre'}}>
            {children}
          </div>
        </code>
      </pre>
    </div>
  )
}
