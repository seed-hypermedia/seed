import {Button} from '@shm/ui/button'
import {NodeViewProps} from '@tiptap/core'
import {NodeViewContent} from '@tiptap/react'
import {Check, ChevronDown} from 'lucide-react'
import {useState} from 'react'

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

  const handleChange = (newLanguage: string) => {
    updateAttributes({language: newLanguage})
    setLanguage(newLanguage)
    setOpen(false)
  }

  return (
    <div
      className="flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setOpen(false)
      }}
    >
      {hovered && (
        <div
          className="absolute top-2 right-4 z-5 flex w-[150px] items-center gap-4 p-1"
          contentEditable={false}
        >
          <div className="relative w-full">
            <Button
              className="border-input bg-background flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-sm shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => setOpen(!open)}
              type="button"
            >
              <span className="truncate">{language || 'plaintext'}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
            {open && (
              <div className="border-muted bg-popover hide-scrollbar absolute left-0 z-50 mt-1 max-h-[60vh] w-full overflow-y-auto rounded-md border p-1 shadow-md">
                {languages.map((item, i) => (
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
              </div>
            )}
          </div>
        </div>
      )}
      <pre className="rounded-md bg-transparent p-3">
        <code className={`hljs language-${language}`}>
          <NodeViewContent />
        </code>
      </pre>
    </div>
  )
}
