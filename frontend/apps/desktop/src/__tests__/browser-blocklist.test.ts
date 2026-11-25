// @vitest-environment node
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'
import {
  BrowserBlocklist,
  browserBlockedPage,
  browserListRefreshInterval,
  parseBrowserBlocklist,
  readBrowserFeed,
} from '../browser-blocklist'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true})))
function cachedList(hosts = ['bad.example']) {
  const directory = mkdtempSync(join(tmpdir(), 'seed-blocklist-'))
  directories.push(directory)
  mkdirSync(join(directory, 'browser'))
  writeFileSync(join(directory, 'browser/blocklist.json'), JSON.stringify({checkedAt: 0, hosts, etag: 'old'}))
  const list = new BrowserBlocklist()
  list.load(directory)
  return {list, directory}
}
it('matches hosts and parent labels, canonicalizes URL hosts, and keeps bundled test sites', () => {
  const {list} = cachedList(['bad.example', '8.8.8.8'])
  expect(list.match('https://Sub.BAD.example.:443/a')).toEqual({host: 'sub.bad.example', list: 'OpenPhish'})
  expect(list.match('https://bad.example/')).toBeDefined()
  expect(list.match('https://notbad.example/')).toBeUndefined()
  expect(list.match('https://bad.example.safe.example/')).toBeUndefined()
  expect(list.match('https://user:bad.example@safe.example/')).toBeUndefined()
  expect(list.match('https://8.8.8.8/')).toBeDefined()
  expect(list.match('data:text/html,bad.example')).toBeUndefined()
  expect(list.match('broken')).toBeUndefined()
  expect(list.match('https://malware.testing.google.test/')).toEqual({
    host: 'malware.testing.google.test',
    list: 'Seed test sites',
  })
})
it('parses URL, hosts-file and domain feeds without comments or local sentinel entries', () => {
  expect(
    parseBrowserBlocklist(
      '# header\nhttps://BAD.example/path?q=a\n0.0.0.0 other.example # comment\n127.0.0.1 third.example\nbad.example\n127.0.0.1 localhost\n<html>\n',
    ),
  ).toEqual(['bad.example', 'other.example', 'third.example'])
})
it('caps streamed bytes and advertised lengths, including multibyte text', async () => {
  await expect(readBrowserFeed(new Response('éé'), 4)).resolves.toBe('éé')
  await expect(readBrowserFeed(new Response('éé'), 3)).rejects.toThrow('size limit')
  await expect(readBrowserFeed(new Response('a', {headers: {'Content-Length': '100'}}), 4)).rejects.toThrow(
    'size limit',
  )
  await expect(readBrowserFeed(new Response('', {status: 503}), 4)).rejects.toThrow('503')
})
it('uses ETags, persists daily attempts across restarts and retains rules on 304 or failed updates', async () => {
  const {list, directory} = cachedList()
  let now = browserListRefreshInterval * 2
  const fetchFeed = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, {status: 304}))
  await list.refresh(fetchFeed, now)
  expect(fetchFeed.mock.calls[0]![1]?.headers).toEqual({'If-None-Match': 'old'})
  expect(list.match('https://bad.example')).toBeDefined()
  const restarted = new BrowserBlocklist()
  restarted.load(directory)
  await restarted.refresh(fetchFeed, now + 1)
  expect(fetchFeed).toHaveBeenCalledOnce()
  now += browserListRefreshInterval
  fetchFeed.mockResolvedValueOnce(new Response('https://new.example/path', {headers: {ETag: 'new'}}))
  await restarted.refresh(fetchFeed, now)
  expect(restarted.match('https://bad.example')).toBeUndefined()
  expect(restarted.match('https://new.example')).toBeDefined()
  expect(JSON.parse(readFileSync(join(directory, 'browser/blocklist.json'), 'utf8')).etag).toBe('new')
  fetchFeed.mockResolvedValueOnce(new Response('a'.repeat(1024 * 1024 + 1)))
  await restarted.refresh(fetchFeed, now + browserListRefreshInterval)
  expect(restarted.match('https://new.example')).toBeDefined()
  await restarted.refresh(fetchFeed, now + browserListRefreshInterval + 1)
  expect(fetchFeed).toHaveBeenCalledTimes(3)
})
it('renders an escaped, script-free interstitial with only back and external-open actions', () => {
  const html = decodeURIComponent(
    browserBlockedPage({host: 'bad.example', list: '<script>feed</script>'}).split(',')[1]!,
  )
  expect(html).toContain('Website blocked')
  expect(html).toContain('bad.example was flagged by &#60;script&#62;feed&#60;/script&#62;')
  expect(html).toContain('seed-browser://back')
  expect(html).toContain('seed-browser://external')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('proceed')
})
