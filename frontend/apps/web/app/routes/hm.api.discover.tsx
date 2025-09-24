import {discoverDocument, discoverMedia} from '@/utils/discovery'
import {ActionFunction} from 'react-router'
import {json} from '@/utils/json'
import {siteDiscoverRequestSchema} from '@shm/shared/hm-types'

export const action: ActionFunction = async ({request}) => {
  try {
    const data = await request.json()
    const input = siteDiscoverRequestSchema.parse(data)
    await discoverDocument(input.uid, input.path, input.version)
    if (data.media) {
      await discoverMedia(input.uid, input.path, input.version)
    }
    return json({message: 'Success'})
  } catch (e) {
    if (e instanceof Error) {
      return json({message: e.message}, {status: 500})
    } else {
      return json({message: 'Unknown error'}, {status: 500})
    }
  }
}
