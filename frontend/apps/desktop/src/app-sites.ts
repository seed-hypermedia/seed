import {getSiteEmailSubscribers} from '@shm/shared/models/notification-service'
import {z} from 'zod'
import {buildDesktopSigner, getNotifyServiceHostDefault} from './app-notifications'
import {t} from './app-trpc'

/** Reads the notifyServiceHost that a site advertises via its /hm/api/config. */
async function getSiteNotifyServiceHost(siteUrl: string): Promise<string | null> {
  const resp = await fetch(`${siteUrl.replace(/\/$/, '')}/hm/api/config`, {})
  if (resp.status !== 200) {
    throw new Error(`Site returned status ${resp.status}`)
  }
  let config
  try {
    config = await resp.json()
  } catch {
    throw new Error('Site returned invalid response')
  }
  return typeof config?.notifyServiceHost === 'string' ? config.notifyServiceHost : null
}

const registerInputSchema = z.object({
  url: z.string(),
  payload: z.any(),
})

export const sitesApi = t.router({
  registerSite: t.procedure.input(registerInputSchema).mutation(async ({input}) => {
    const resp = await fetch(input.url, {
      method: 'POST',
      body: JSON.stringify(input.payload),
    })
    if (resp.status !== 200) {
      let message = `Site returned status ${resp.status}`
      try {
        const error = await resp.json()
        if (error.message) message = error.message
      } catch {
        // Response wasn't JSON
      }
      throw new Error(message)
    }
    let result
    try {
      result = await resp.json()
    } catch {
      throw new Error('Site returned invalid response')
    }
    return result
  }),
  getConfig: t.procedure.input(z.string()).mutation(async ({input}) => {
    const resp = await fetch(`${input}/hm/api/config`, {})
    if (resp.status !== 200) {
      let message = `Site returned status ${resp.status}`
      try {
        const error = await resp.json()
        if (error.message) message = error.message
      } catch {
        // Response wasn't JSON
      }
      throw new Error(message)
    }
    let result
    try {
      result = await resp.json()
    } catch {
      throw new Error('Site returned invalid response')
    }
    return result
  }),
  // Discovers the site's notify service through its /hm/api/config (falling
  // back to the app default host for sites without a published siteUrl), then
  // requests the site account's subscriber emails. The request is signed with
  // the signAs key (the selected identity), delegated to the site account —
  // the notify service verifies the AGENT capability when they differ.
  getEmailSubscribers: t.procedure
    .input(z.object({siteUrl: z.string().optional(), accountUid: z.string(), signAs: z.string().optional()}))
    .query(async ({input}) => {
      const notifyServiceHost =
        (input.siteUrl ? await getSiteNotifyServiceHost(input.siteUrl) : null) ?? getNotifyServiceHostDefault()
      if (!notifyServiceHost) {
        throw new Error('No notification service is configured for this site')
      }
      const signAs = input.signAs ?? input.accountUid
      const signer = buildDesktopSigner(signAs)
      if (signAs !== input.accountUid) {
        signer.accountUid = input.accountUid
      }
      return getSiteEmailSubscribers(notifyServiceHost, signer)
    }),
})
