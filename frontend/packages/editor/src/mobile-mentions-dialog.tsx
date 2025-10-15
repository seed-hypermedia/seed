import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {
  InlineMentionsResult,
  useInlineMentions,
} from '@shm/shared/models/inline-mentions'
import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {LoadedHMIcon} from '@shm/ui/hm-icon'
import {Search, X} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {useEffect, useState} from 'react'

interface MobileMentionsDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (mention: {
    id: UnpackedHypermediaId
    label: string
    type: string
  }) => void
  perspectiveAccountUid?: string | null | undefined
}

export function MobileMentionsDialog({
  isOpen,
  onClose,
  onSelect,
  perspectiveAccountUid,
}: MobileMentionsDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<InlineMentionsResult>({
    Sites: [],
    Documents: [],
    Recents: [],
    Contacts: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const {onMentionsQuery} = useInlineMentions(perspectiveAccountUid)

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setResults({Sites: [], Documents: [], Recents: [], Contacts: []})
      return
    }

    const search = async () => {
      setIsLoading(true)
      try {
        const mentionResults = await onMentionsQuery(searchQuery)
        setResults(mentionResults)
      } catch (error) {
        console.error('Failed to search mentions:', error)
      } finally {
        setIsLoading(false)
      }
    }

    const timeoutId = setTimeout(search, 300)
    return () => clearTimeout(timeoutId)
  }, [searchQuery, isOpen])

  const handleSelectMention = (item: any) => {
    onSelect({
      id: item.id,
      label: item.title || item.label || 'Unknown',
      type: item.type,
    })
    onClose()
  }

  const allResults = [
    ...results.Contacts,
    ...results.Sites,
    ...results.Documents,
    ...results.Recents,
  ]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-full max-h-full w-full max-w-full rounded-none p-0">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b p-4">
            <div className="flex items-center justify-between">
              <DialogTitle>Mention Someone</DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="border-b p-4">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search for people, sites, or documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                autoFocus
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <SizableText className="text-muted-foreground">
                  Searching...
                </SizableText>
              </div>
            ) : allResults.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <SizableText className="text-muted-foreground">
                  {searchQuery
                    ? 'No results found'
                    : 'Start typing to search...'}
                </SizableText>
              </div>
            ) : (
              <div className="divide-y">
                {results.Contacts.length > 0 && (
                  <MentionSection
                    title="Contacts"
                    items={results.Contacts}
                    onSelect={handleSelectMention}
                  />
                )}
                {results.Sites.length > 0 && (
                  <MentionSection
                    title="Sites"
                    items={results.Sites}
                    onSelect={handleSelectMention}
                  />
                )}
                {results.Documents.length > 0 && (
                  <MentionSection
                    title="Documents"
                    items={results.Documents}
                    onSelect={handleSelectMention}
                  />
                )}
                {results.Recents.length > 0 && searchQuery === '' && (
                  <MentionSection
                    title="Recent"
                    items={results.Recents}
                    onSelect={handleSelectMention}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MentionSection({
  title,
  items,
  onSelect,
}: {
  title: string
  items: any[]
  onSelect: (item: any) => void
}) {
  if (items.length === 0) return null

  return (
    <div className="py-2">
      <SizableText
        size="xs"
        weight="medium"
        className="text-muted-foreground px-4 py-2"
      >
        {title}
      </SizableText>
      {items.map((item) => (
        <Button
          key={item.id.id}
          variant="ghost"
          className="h-auto w-full justify-start px-4 py-3"
          onClick={() => onSelect(item)}
        >
          <div className="flex items-center gap-3">
            <LoadedHMIcon id={item.id} size={32} />
            <div className="flex flex-col items-start">
              <SizableText>{item.title || 'Untitled'}</SizableText>
              {item.subtitle && (
                <SizableText size="xs" className="text-muted-foreground">
                  {item.subtitle}
                </SizableText>
              )}
            </div>
          </div>
        </Button>
      ))}
    </div>
  )
}
