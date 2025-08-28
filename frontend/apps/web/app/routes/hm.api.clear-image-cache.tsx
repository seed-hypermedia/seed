import {ActionFunction, json} from '@remix-run/node'
import fs from 'fs/promises'
import path from 'path'

const CACHE_PATH = path.resolve(
  path.join(process.env.DATA_DIR || process.cwd(), 'image-cache'),
)

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({error: 'Method not allowed'}, {status: 405})
  }

  const url = new URL(request.url)
  const cid = url.searchParams.get('cid')

  try {
    if (cid) {
      // Clear cache for specific CID
      const files = await fs.readdir(CACHE_PATH).catch(() => [])
      const filesToDelete = files.filter(file => file.startsWith(cid))
      
      for (const file of filesToDelete) {
        await fs.unlink(path.join(CACHE_PATH, file)).catch(() => {})
      }
      
      return json({
        success: true,
        message: `Cleared cache for CID: ${cid}`,
        deletedFiles: filesToDelete.length
      })
    } else {
      // Clear entire cache
      await fs.rm(CACHE_PATH, {recursive: true, force: true}).catch(() => {})
      await fs.mkdir(CACHE_PATH, {recursive: true}).catch(() => {})
      
      return json({
        success: true,
        message: 'Cleared entire image cache'
      })
    }
  } catch (error) {
    console.error('Error clearing cache:', error)
    return json({
      error: 'Failed to clear cache',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, {status: 500})
  }
}