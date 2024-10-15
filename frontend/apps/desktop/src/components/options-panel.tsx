import {useDraft, useWriteDraft} from '@/models/accounts'
import {useNavigate} from '@/utils/useNavigate'
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
  const navigate = useNavigate()
  const draft = useDraft(draftId)

  const writeDraft = useWriteDraft(draftId)
  return (
    <AccessoryContainer title="Options" onClose={onClose}>
      <YStack>
        <Label>Layout</Label>
        <SelectDropdown
          options={
            [
              {label: 'Newspaper Home', value: 'seed/experimental/newspaper'},
              {label: 'Document', value: 'document'},
            ] as const
          }
          value={draft.data?.metadata?.layout || 'document'}
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
