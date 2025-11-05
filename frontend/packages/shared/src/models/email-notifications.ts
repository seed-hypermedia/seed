import {useMutation} from '@tanstack/react-query'

export type SubscribePayload = {
  notifyServiceHost: string
  action: 'subscribe'
  email: string
  accountId: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
  notifyOwnedDocChange: boolean
  notifySiteDiscussions: boolean
}

async function subscribeToNotifications({
  notifyServiceHost,
  ...payload
}: SubscribePayload): Promise<void> {
  const response = await fetch(`${notifyServiceHost}/hm/api/public-subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to subscribe')
  }
}

export function useSubscribeToNotifications() {
  return useMutation({
    mutationFn: subscribeToNotifications,
  })
}
