import {client} from '@/trpc'
import {setDeleteRecents, setRecentsQuery} from '@shm/shared/models/recents'

setRecentsQuery(async () => {
  const r = await client.recents.getRecents.query()
  return r
})

setDeleteRecents(async (id: string) => {
  await client.recents.deleteRecent.mutate(id)
})
