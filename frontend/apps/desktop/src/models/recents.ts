import {client} from '@/trpc'
import {RecentsResult} from '@shm/shared/models/recents'

export async function fetchRecents(): Promise<RecentsResult[]> {
  const r = await client.recents.getRecents.query()
  return r
}

export async function deleteRecent(id: string): Promise<void> {
  await client.recents.deleteRecent.mutate(id)
}
