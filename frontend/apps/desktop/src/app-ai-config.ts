import fs from 'fs/promises'
import path from 'path'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'

const configPath = path.join(userDataPath, 'ai-config.json')

export async function readConfig(): Promise<Record<string, any>> {
  try {
    const content = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function writeConfig(config: Record<string, any>): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  appInvalidateQueries(['AI_CONFIG'])
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.')
  let current: any = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.')
  const result = {...obj}
  let current: any = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = current[key] != null && typeof current[key] === 'object' ? {...current[key]} : {}
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
  return result
}

export const aiConfigApi = t.router({
  get: t.procedure.query(async () => {
    return await readConfig()
  }),
  getValue: t.procedure.input(z.string()).query(async ({input}) => {
    const config = await readConfig()
    return getNestedValue(config, input) ?? null
  }),
  setValue: t.procedure.input(z.object({path: z.string(), value: z.any()})).mutation(async ({input}) => {
    const config = await readConfig()
    const updated = setNestedValue(config, input.path, input.value)
    await writeConfig(updated)
    return null
  }),
})
