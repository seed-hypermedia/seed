import {AlertDialog, Button, Text, XStack, YStack} from '@shm/ui'
import {useAppDialog} from './dialog'

export type ImportedDocument = {
  markdownContent: string
  title: string
  directoryPath: string
}

export function useImportDialog() {
  return useAppDialog(ImportDialog, {isAlert: true})
}

function ImportDialog({
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
  // const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])

  // // Toggle selection of a document
  // const handleCheckboxToggle = (documentTitle: string) => {
  //   if (selectedDocuments.includes(documentTitle)) {
  //     setSelectedDocuments(
  //       selectedDocuments.filter((title) => title !== documentTitle),
  //     )
  //   } else {
  //     setSelectedDocuments([...selectedDocuments, documentTitle])
  //   }
  // }

  // // Confirm and pass selected documents to onSuccess handler
  // const handleConfirm = () => {
  //   const selectedDocs = documents.filter((doc) =>
  //     selectedDocuments.includes(doc.title),
  //   )
  //   onSuccess(selectedDocs, docMap)
  //   onClose()
  // }

  return (
    // <YStack gap="$4" padding="$4" borderRadius="$3">
    //   <AlertDialog.Title>
    //     <Text fontWeight="bold">{`${documentCount} documents found.`}</Text>
    //   </AlertDialog.Title>
    //   <AlertDialog.Description>
    //     <Text>Select which documents you want to import:</Text>
    //   </AlertDialog.Description>

    //   {/* List of documents with checkboxes */}
    //   <YStack padding="$4" space="$3">
    //     {documents.map((doc) => (
    //       <XStack key={doc.title} alignItems="center" space="$2">
    //         <Checkbox
    //           checked={selectedDocuments.includes(doc.title)}
    //           onCheckedChange={() => handleCheckboxToggle(doc.title)}
    //           onPress={(e: MouseEvent) => {
    //             e.stopPropagation()
    //           }}
    //           borderColor="$color8"
    //           focusStyle={{borderColor: '$color10'}}
    //         >
    //           <Checkbox.Indicator borderColor="$color8">
    //             <Check />
    //           </Checkbox.Indicator>
    //         </Checkbox>
    //         <Text>{doc.title}</Text>
    //       </XStack>
    //     ))}
    //   </YStack>

    //   {/* Action buttons */}
    //   <YStack padding="$4" space="$3">
    //     <XStack gap="$3" justifyContent="flex-end">
    //       <AlertDialog.Cancel asChild>
    //         <Button
    //           onPress={() => {
    //             onClose()
    //           }}
    //           chromeless
    //         >
    //           Cancel
    //         </Button>
    //       </AlertDialog.Cancel>
    //       <AlertDialog.Action asChild>
    //         <Button theme="green" onPress={handleConfirm}>
    //           Continue Import
    //         </Button>
    //       </AlertDialog.Action>
    //     </XStack>
    //   </YStack>
    // </YStack>

    <YStack gap="$4" padding="$4" borderRadius="$3">
      <AlertDialog.Title>
        <Text fontWeight="bold">{`${documentCount} documents found.`}</Text>
      </AlertDialog.Title>
      <AlertDialog.Description>
        <Text>Do you want to continue with the import?</Text>
      </AlertDialog.Description>
      <YStack padding="$4" space="$3">
        <XStack gap="$3" justifyContent="flex-end">
          <AlertDialog.Cancel asChild>
            <Button
              onPress={() => {
                onClose()
              }}
              chromeless
            >
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <Button
              theme="green"
              onPress={() => {
                onSuccess(documents, docMap)
                onClose()
              }}
            >
              Continue Import
            </Button>
          </AlertDialog.Action>
        </XStack>
      </YStack>
    </YStack>
  )
}
