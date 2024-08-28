import {DraftRoute, UnpackedHypermediaId} from '@shm/shared'
import {NavMode} from './navigation'
import {useNavigate} from './useNavigate'

export function useOpenDraft(navigateMode: NavMode = 'spawn') {
  const navigate = useNavigate(navigateMode)
  function openDraft(opts?: {id?: UnpackedHypermediaId}) {
    const draftRoute: DraftRoute = {
      key: 'draft',
      id: opts?.id || undefined,
    }
    navigate(draftRoute)
  }
  return openDraft
}
