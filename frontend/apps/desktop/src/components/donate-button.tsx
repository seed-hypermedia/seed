import {useEntities, useEntity} from '@/models/entities'
import {
  getAccountName,
  hmId,
  LIGHTNING_API_URL,
  UnpackedHypermediaId,
} from '@shm/shared'
import {CheckboxField, HMIcon} from '@shm/ui'
import {CircleDollarSign} from '@tamagui/lucide-icons'
import {useState} from 'react'
import {
  Button,
  DialogDescription,
  Input,
  SizableText,
  XStack,
  YStack,
} from 'tamagui'
import {DialogTitle, useAppDialog} from './dialog'

export function DonateButton({docId}: {docId: UnpackedHypermediaId}) {
  const donateDialog = useAppDialog(DonateDialog)
  return (
    <>
      <Button
        icon={CircleDollarSign}
        theme="green"
        onPress={() => {
          donateDialog.open(docId)
        }}
        size="$2"
      />
      {donateDialog.content}
    </>
  )
}

function DonateDialog({
  input,
  onClose,
}: {
  input: UnpackedHypermediaId
  onClose: () => void
}) {
  const entity = useEntity(input)
  const authors = useEntities(
    entity.data?.document?.authors?.map((author) => hmId('d', author)) || [],
  )
  const [paymentAllocation, setPaymentAllocation] = useState<{
    evenly: boolean
    accounts?: Record<string, number>
    total: number
  }>({evenly: true, total: 100})
  return (
    <>
      <DialogTitle>Donate to Authors</DialogTitle>
      <DialogDescription>Send Bitcoin to authors</DialogDescription>
      <CheckboxField
        id="split-evenly"
        value={paymentAllocation.evenly}
        onValue={(isEvenly) =>
          setPaymentAllocation((allocation) => {
            return {evenly: isEvenly, total: paymentAllocation.total}
          })
        }
      >
        Split Evenly
      </CheckboxField>
      <YStack>
        {authors.map((author) => {
          if (!author.data) return null
          return (
            <XStack jc="space-between">
              <XStack ai="center" gap="$4">
                <HMIcon
                  id={author.data.id}
                  metadata={author.data?.document?.metadata}
                />
                <SizableText>
                  {getAccountName(author.data?.document)}
                </SizableText>
              </XStack>
              <Input placeholder="0" />
            </XStack>
          )
        })}
      </YStack>
      <DialogDescription>{LIGHTNING_API_URL}</DialogDescription>
      <Button themeInverse theme="green">
        Donate
      </Button>
    </>
  )
}
