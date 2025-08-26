import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'

export type ImportedDocument = {
  markdownContent: string
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
    onSuccess: (
      documents: ImportedDocument[],
      docMap: Map<string, {name: string; path: string}>,
    ) => Promise<void>
  }
}) {
  const {documents, documentCount, docMap, onSuccess} = input

  return (
    <div className="flex flex-col gap-4 rounded-md p-4">
      <Text className="text-lg font-semibold">
        <Text weight="bold">{`${documentCount} documents found.`}</Text>
      </Text>
      <Text className="text-muted-foreground text-sm">
        <Text>Do you want to continue with the import?</Text>
      </Text>
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
              onSuccess(documents, docMap)
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
