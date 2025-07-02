import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {AlertDialog} from 'tamagui'
import {useAppDialog} from './dialog'

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
      <AlertDialog.Title>
        <Text weight="bold">{`${documentCount} documents found.`}</Text>
      </AlertDialog.Title>
      <AlertDialog.Description>
        <Text>Do you want to continue with the import?</Text>
      </AlertDialog.Description>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex justify-end gap-3">
          <AlertDialog.Cancel asChild>
            <Button
              onClick={() => {
                onClose()
              }}
              variant="ghost"
            >
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <Button
              variant="default"
              onClick={() => {
                onSuccess(documents, docMap)
                onClose()
              }}
            >
              Continue Import
            </Button>
          </AlertDialog.Action>
        </div>
      </div>
    </div>
  )
}
