import {HMResourceVisibility} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {SizableText, Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Globe, Info, Lock} from 'lucide-react'
import {useState} from 'react'

export type ImportedDocument = {
  markdownContent?: string
  latexContent?: string
  title: string
  directoryPath: string
}

export function useImportConfirmDialog() {
  return useAppDialog(ImportConfirmDialog, {isAlert: true})
}

function ImportConfirmDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {
    documents: ImportedDocument[]
    documentCount: number
    docMap: Map<string, {name: string; path: string}>
    canCreatePrivateDoc: boolean
    onSuccess: (
      documents: ImportedDocument[],
      docMap: Map<string, {name: string; path: string}>,
      visibility: HMResourceVisibility,
    ) => Promise<void>
  }
}) {
  const {documents, documentCount, docMap, canCreatePrivateDoc, onSuccess} = input
  const [visibility, setVisibility] = useState<HMResourceVisibility>('PUBLIC')

  return (
    <div className="flex flex-col gap-4 rounded-md p-4">
      <Text className="text-lg font-semibold">
        <Text weight="bold">{`${documentCount} documents found.`}</Text>
      </Text>
      <Text className="text-muted-foreground text-sm">
        <Text>Do you want to continue with the import?</Text>
      </Text>
      <div className="flex flex-col gap-2">
        <SizableText size="sm" weight="bold">
          Visibility
        </SizableText>
        <div className="flex gap-2">
          <Button
            variant={visibility === 'PUBLIC' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVisibility('PUBLIC')}
          >
            <Globe className="size-3.5" />
            Public
          </Button>
          {canCreatePrivateDoc ? (
            <Button
              variant={visibility === 'PRIVATE' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVisibility('PRIVATE')}
            >
              <Lock className="size-3.5" />
              Private
            </Button>
          ) : (
            <Tooltip
              content="To import private documents, you need to configure a web domain and import into the home document."
              side="bottom"
              asChild
            >
              <Button variant="outline" size="sm" className="cursor-default opacity-50">
                <Lock className="size-3.5" />
                Private
                <Info className="text-muted-foreground size-3" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex justify-end gap-3">
          <Button
            onClick={() => {
              onClose()
            }}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              onSuccess(documents, docMap, visibility)
              onClose()
            }}
          >
            Continue Import
          </Button>
        </div>
      </div>
    </div>
  )
}
