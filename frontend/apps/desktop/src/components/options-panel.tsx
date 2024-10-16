import {useDraft, useWriteDraft} from '@/models/accounts'
import {UnpackedHypermediaId} from '@shm/shared'
import {SelectDropdown} from '@shm/ui'
import {Label, YStack} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'

export function OptionsPanel({
  onClose,
  draftId,
}: {
  onClose: () => void
  draftId: UnpackedHypermediaId
}) {
  const draft = useDraft(draftId)

  const writeDraft = useWriteDraft(draftId)
  const layout = draft.data?.metadata?.layout || ''
  return (
    <AccessoryContainer title="Options" onClose={onClose}>
      <YStack>
        <Label size="$1">Layout</Label>
        <SelectDropdown
          options={
            [
              {label: 'Newspaper Home', value: 'Seed/Experimental/Newspaper'},
              {label: 'Document', value: ''},
            ] as const
          }
          value={layout}
          onValue={(value) => {
            if (!value || !draft.data) return
            writeDraft({
              ...draft.data,
              metadata: {...draft.data.metadata, layout: value},
            })
          }}
        />
      </YStack>
    </AccessoryContainer>
  )
}
