import {NavMode} from './navigation'
import {DraftRoute} from './routes'
import {useNavigate} from './useNavigate'

export function useOpenDraft(navigateMode: NavMode = 'spawn') {
  const navigate = useNavigate(navigateMode)
  function openNewDraft(opts?: {id?: string; pathName?: string | null}) {
    const draftRoute: DraftRoute = {
      key: 'draft',
      id: opts?.id || undefined,
    }
    navigate(draftRoute)
  }
  return openNewDraft
}
