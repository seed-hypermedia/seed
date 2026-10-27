import {mountApp} from './bridge.js'

/** Run fixed probes through the same browser sandbox and bridge as generated pages. */
export async function runChecks(runnerOrigin, report = () => {}) {
  const run = crypto.randomUUID()
  const results = []
  async function probe(script, {page = 'a', viewer = 'Alice', grants = []} = {}) {
    const container = document.createElement('div')
    container.hidden = true
    document.body.append(container)
    const artifact = {
      id: `probe-${run}-${page}`,
      revision: 'probe-v1',
      title: 'Boundary probe',
      html: `<html><body><script>(async () => {let result; try {result = await (async () => {${script}})()} catch (error) {result = {error: error.message}} await seed.storage.set('__probe', result)})()</script></body></html>`,
    }
    let session
    try {
      return await new Promise((resolve, reject) => {
        session = mountApp({
          container,
          runnerOrigin,
          artifact,
          viewer,
          grants,
          resource: async () => ({title: 'Sample brief'}),
          onEvent: (event) => {
            if (event.type === 'request' && event.key === '__probe') {
              if (event.error) reject(new Error(event.error))
              else
                resolve(
                  JSON.parse(localStorage.getItem(`seed-page-demo:${JSON.stringify([viewer, artifact.id])}:__probe`)),
                )
            }
          },
        })
        session.ready.catch(reject)
      })
    } finally {
      session?.destroy()
      container.remove()
    }
  }
  function check(name, pass) {
    const result = {name, pass: !!pass}
    results.push(result)
    report(result)
  }
  try {
    const isolation = await probe(`
      const result = {};
      for (const [name, fn] of Object.entries({parentDOM: () => parent.document.body, nativeStorage: () => localStorage.getItem('anything'), cookies: () => document.cookie})) {
        try {fn(); result[name] = false} catch {result[name] = true}
      }
      try {await fetch(${JSON.stringify(
        `${runnerOrigin}/sink?signal=fetch`,
      )}); result.fetch = false} catch {result.fetch = true}
      try {await seed.resource('project-brief'); result.permission = false} catch {result.permission = true}
      return result;
    `)
    check('Parent page is inaccessible', isolation.parentDOM)
    check('Native browser storage and cookies are inaccessible', isolation.nativeStorage && isolation.cookies)
    check('Direct fetch is blocked', isolation.fetch)
    check('Document read is denied before a grant', isolation.permission)
    await probe("await seed.storage.set('note', 'Alice wrote this'); return true")
    check(
      'Storage survives a new page instance',
      (await probe("return await seed.storage.get('note')")) === 'Alice wrote this',
    )
    check(
      'A separate page cannot read the note',
      (await probe("return await seed.storage.get('note')", {page: 'b'})) === null,
    )
    check(
      'Another account cannot read the note',
      (await probe("return await seed.storage.get('note')", {viewer: 'Bob'})) === null,
    )
    check(
      'An explicit grant allows the selected document',
      (await probe("return (await seed.resource('project-brief')).title", {grants: ['project-brief']})) ===
        'Sample brief',
    )
    check(
      'Revocation denies the next instance',
      (await probe("try {await seed.resource('project-brief'); return false} catch {return true}")) === true,
    )
    return results
  } finally {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('seed-page-demo:') && key.includes(`probe-${run}-`)) localStorage.removeItem(key)
  }
}
