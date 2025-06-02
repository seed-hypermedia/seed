import {AssistMessage, AssistThread} from '@/app-assist'
import {AppWindowEvent} from '@/utils/window-events'
import {NavRoute} from '@shm/shared'
import {client} from '../trpc'

export type HMAI = {
  // generate: (prompt: string) => Promise<string>
  startThread: (input: {prompt: string; route: NavRoute}) => Promise<string>
  getThread: (threadId: string) => Promise<AssistThread>
  continueThread: (threadId: string, prompt: string) => Promise<void>
  subscribeThread: (
    threadId: string,
    handler: (message: AssistMessage) => void,
  ) => () => void
}

export function setupAI() {
  console.log('setupAI')
  try {
    // const generate = async (prompt: string) => {
    //   console.log('prompt', prompt)
    //   const result = await client.ai.generate.mutate({prompt})
    //   console.log('text', result.text)
    //   return result.text
    // }

    return {
      // generate,
      startThread: async (input: {prompt: string; route: NavRoute}) => {
        const result = await client.assist.startThread.mutate({
          prompt: input.prompt,
          route: input.route,
        })
        return result.threadId
      },
      getThread: async (threadId: string) => {
        const result = await client.assist.getThread.query({threadId})
        return result
      },
      continueThread: async (threadId: string, prompt: string) => {
        await client.assist.continueThread.mutate({threadId, prompt})
      },
      subscribeThread: (
        threadId: string,
        handler: (message: AssistMessage) => void,
      ) => {
        return (
          window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
            if (typeof event === 'object' && event.key === 'assistMessage') {
              handler(event.message)
            }
          }) || (() => {})
        )
      },
    } satisfies HMAI
  } catch (error) {
    console.error('Failed to setup AI:', error)
    return null
  }
}
