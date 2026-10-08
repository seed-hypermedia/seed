// GHSA-ch52-4w7c-c8xp: https://github.com/advisories/GHSA-ch52-4w7c-c8xp
// RFC-grounded revalidation defect, distinct from the disputed cookie claim.
// Backport source: https://github.com/kornelski/http-cache-semantics/pull/63
const assert = require('node:assert/strict')
const {test} = require('node:test')
const {createRequire} = require('node:module')
const {resolve} = require('node:path')
const CachePolicy = createRequire(resolve(__dirname, '../../package.json'))(
  process.env.HTTP_CACHE_POLICY || 'http-cache-semantics',
)

const request = {url: '/account', method: 'GET', headers: {host: 'example.test', 'accept-language': 'en'}}
function policy(directives, {shared = true, age = '10', headers = {}} = {}) {
  const result = new CachePolicy(
    request,
    {
      status: 200,
      headers: {
        'cache-control': directives,
        age,
        vary: 'accept-language',
        etag: '"example"',
        ...headers,
      },
    },
    {shared},
  )
  result.now = () => result._responseTime
  return result
}
function restored(original) {
  const result = CachePolicy.fromObject(original.toObject())
  result.now = () => result._responseTime
  return result
}
function withCacheControl(value) {
  return {...request, headers: {...request.headers, 'cache-control': value}}
}

for (const restriction of [
  'no-cache',
  'proxy-revalidate',
  's-maxage=1',
  's-maxage=0',
  'must-revalidate',
  'private',
  'no-store',
  'No-Cache',
]) {
  test(`revalidation restriction ${restriction} survives max-stale, stale extensions, and serialization`, () => {
    const original = policy(`max-age=1, ${restriction}, stale-while-revalidate=100, stale-if-error=100`)
    for (const item of [original, restored(original)]) {
      for (const directive of ['max-stale', 'max-stale=1000']) {
        const evaluation = item.evaluateRequest(withCacheControl(directive))
        assert.equal(evaluation.response, undefined)
        assert.equal(evaluation.revalidation.synchronous, true)
        assert.equal(item.satisfiesWithoutRevalidation(withCacheControl(directive)), false)
      }
      assert.equal(item.useStaleWhileRevalidate(), false)
      assert.equal(item.revalidatedPolicy(request, {status: 503, headers: {}}).modified, true)
    }
  })
}
for (const restriction of ['must-revalidate', 'proxy-revalidate', 's-maxage=60']) {
  test(`fresh ${restriction} responses remain reusable`, () => {
    assert.equal(policy(`max-age=60, ${restriction}`).satisfiesWithoutRevalidation(request), true)
  })
}
test('ordinary stale content honors permitted max-stale and positive stale extensions', () => {
  const item = policy('max-age=1, stale-while-revalidate=100, stale-if-error=100')
  assert.equal(item.satisfiesWithoutRevalidation(withCacheControl('max-stale=9')), true)
  assert.equal(item.satisfiesWithoutRevalidation(withCacheControl('max-stale=8')), false)
  assert.equal(item.useStaleWhileRevalidate(), true)
  assert.equal(item.revalidatedPolicy(request, {status: 503, headers: {}}).policy, item)
})
test('private caches retain allowed stale reuse of proxy-only restrictions', () => {
  for (const directive of ['private', 'proxy-revalidate', 's-maxage=0']) {
    assert.equal(
      policy(`max-age=1, ${directive}`, {shared: false}).satisfiesWithoutRevalidation(withCacheControl('max-stale')),
      true,
    )
  }
})
test('shared cookie safeguard and public/immutable opt-ins remain consistent', () => {
  for (const [directives, shared, allowed] of [
    ['', true, false],
    [', public', true, true],
    [', immutable', true, true],
    ['', false, true],
  ]) {
    const item = policy(`max-age=1, stale-if-error=100${directives}`, {
      shared,
      headers: {'set-cookie': 'session=test-only'},
    })
    assert.equal(item.satisfiesWithoutRevalidation(withCacheControl('max-stale')), allowed)
    assert.equal(item.revalidatedPolicy(request, {status: 503, headers: {}}).policy === item, allowed)
  }
})
test('error fallback requires matching URL, method, host, and Vary request headers', () => {
  const item = policy('max-age=1, stale-if-error=100')
  for (const other of [
    {...request, url: '/other'},
    {...request, method: 'POST'},
    {...request, headers: {...request.headers, host: 'other.test'}},
    {...request, headers: {...request.headers, 'accept-language': 'fr'}},
  ])
    assert.equal(item.revalidatedPolicy(other, {status: 503, headers: {}}).modified, true)
})
test('a fresh response without stale-if-error is not an error fallback', () => {
  const item = policy('max-age=60')
  assert.equal(item.revalidatedPolicy(request, {status: 503, headers: {}}).modified, true)
})
test('successful origin validation still permits reuse of restricted response bodies', () => {
  for (const directive of ['no-cache', 'must-revalidate', 'proxy-revalidate', 's-maxage=1']) {
    const item = policy(`max-age=1, ${directive}`)
    assert.equal(item.revalidatedPolicy(request, {status: 304, headers: {etag: '"example"'}}).modified, false)
  }
})
test('the 4.3.0 Vary wildcard fix remains intact after the backport', () => {
  for (const vary of [' * ', 'accept-language, *']) {
    assert.equal(policy('max-age=60', {headers: {vary}}).satisfiesWithoutRevalidation(request), false)
  }
})
