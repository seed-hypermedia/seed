import {z} from 'zod'
import {t} from './app-trpc'

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
})
