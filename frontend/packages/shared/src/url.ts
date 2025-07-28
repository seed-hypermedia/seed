import {UnpackedHypermediaId} from './hm-types'
import {useUniversalAppContext} from './routing'
import {createWebHMUrl} from './utils'

export function useResourceUrl(targetDomain?: string) {
  const {origin} = useUniversalAppContext()
  return (id: UnpackedHypermediaId) => {
    const url = createWebHMUrl(id.uid, {
      ...id,
      hostname: targetDomain || origin,
    })
    return url
  }
}
