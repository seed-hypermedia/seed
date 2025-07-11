import {UnpackedHypermediaId} from './hm-types'
import {useUniversalAppContext} from './routing'
import {createWebHMUrl} from './utils'

export function useResourceUrl() {
  const {origin} = useUniversalAppContext()
  return (id: UnpackedHypermediaId) => {
    console.log('~origin', origin)
    console.log('~id', id)
    const url = createWebHMUrl(id.uid, {
      ...id,
      hostname: origin,
    })
    console.log('~url', url)
    return url
  }
}
