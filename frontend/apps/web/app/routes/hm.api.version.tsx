import type {LoaderFunction} from 'react-router'
import {json} from '@/utils/json'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import fs from 'fs/promises'

function stripNewlines(str: string) {
  return str.replace(/\r?\n|\r/g, '')
}

async function getVersionInfo() {
  let commit: string | null = null
  let branch: string | null = null
  let date: string | null = null
  try {
    commit = await fs.readFile('COMMIT_HASH', 'utf8')
  } catch (e) {
    console.error('Failed to read COMMIT_HASH file', e)
  }
  try {
    branch = await fs.readFile('BRANCH', 'utf8')
  } catch (e) {
    console.error('Failed to read BRANCH file', e)
  }
  try {
    date = await fs.readFile('DATE', 'utf8')
  } catch (e) {
    console.error('Failed to read DATE file', e)
  }
  return {
    commit: commit ? stripNewlines(commit) : null,
    branch: branch ? stripNewlines(branch) : null,
    date: date ? stripNewlines(date) : null,
  }
}

async function getDaemonVersionInfo() {
  const version = await fetch(`${DAEMON_HTTP_URL}/debug/version`)
  return await version.json()
}

let versionInfo: Awaited<ReturnType<typeof getVersionInfo>> | null = null

export const loader: LoaderFunction = async () => {
  if (!versionInfo) {
    versionInfo = await getVersionInfo()
  }
  return json({web: versionInfo, daemon: await getDaemonVersionInfo()})
}
