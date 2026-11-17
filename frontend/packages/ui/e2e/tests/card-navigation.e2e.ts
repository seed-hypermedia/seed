import {expect, test} from '@playwright/test'

test.beforeEach(async ({page}) => {
  await page.goto('/?sidebar')
})

test('follows Card order and opens the latest whole document', async ({page}) => {
  const sidebar = page.getByRole('complementary', {name: 'Document navigation'})
  await expect(
    sidebar
      .getByRole('treeitem')
      .getByRole('button')
      .filter({hasText: /^(Guides|Install Seed)$/}),
  ).toHaveText(['Guides', 'Install Seed'])
  await sidebar.getByRole('button', {name: 'Document Install Seed', exact: true}).click()
  await expect(page.getByLabel('Navigation destination')).toHaveText(
    'hm://navigation-fixture/reference/install | latest=true | version=',
  )
  await expect(sidebar.getByRole('button', {name: 'Document Install Seed', exact: true})).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sidebar.getByRole('button', {name: 'Unpublished draft Working draft', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Inspect requests'}).click()
  const requests = JSON.parse((await page.getByLabel('Resource requests').textContent()) ?? '[]')
  expect(
    requests.every(
      (id: {latest: boolean; version: string | null; blockRef: string | null}) =>
        id.latest && !id.version && !id.blockRef,
    ),
  ).toBe(true)
  // Home's Card to Archive is pinned to a version, so it is not navigation and Archive is never fetched.
  expect(requests.some((id: {id: string}) => id.id === 'hm://navigation-fixture/archive')).toBe(false)
  const directoryRequests = JSON.parse((await page.getByLabel('Directory requests').textContent()) ?? '[]')
  // Navigation is built from Cards alone; nothing lists the space until a search query is typed.
  expect(directoryRequests).toEqual([])
})

test('updates navigation from the published latest cache and follows moved targets', async ({page}) => {
  const sidebar = page.getByRole('complementary', {name: 'Document navigation'})
  await expect(sidebar.getByRole('button', {name: 'Document Install Seed', exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Publish new Home version'}).click()
  await expect(sidebar.getByRole('button', {name: 'Document Install Seed', exact: true})).toHaveCount(0)
  await expect(
    sidebar
      .getByRole('treeitem')
      .getByRole('button')
      .filter({hasText: /^(Archive|Guides)$/}),
  ).toHaveText(['Archive', 'Guides'])
  await page.getByRole('button', {name: 'Link moved page'}).click()
  await sidebar.getByRole('button', {name: 'Document Install Seed', exact: true}).click()
  await expect(page.getByLabel('Navigation destination')).toHaveText(
    'hm://navigation-fixture/reference/install | latest=true | version=',
  )
})

test('keeps pages without Cards reachable through search only', async ({page}) => {
  const sidebar = page.getByRole('complementary', {name: 'Document navigation'})
  await expect(sidebar.getByRole('button', {name: 'Document Unlisted page', exact: true})).toHaveCount(0)
  await expect(sidebar.getByRole('link')).toHaveCount(0)
  await sidebar.getByRole('button', {name: 'Filter documents', exact: true}).click()
  await sidebar.getByRole('textbox', {name: 'Filter documents'}).fill('Unlisted')
  await sidebar.getByRole('button', {name: 'Document Unlisted page', exact: true}).click()
  await expect(page.getByLabel('Navigation destination')).toHaveText(
    'hm://navigation-fixture/hidden | latest=true | version=',
  )
})

test('expands cross-path navigation and stops ancestor cycles', async ({page}) => {
  const sidebar = page.getByRole('complementary', {name: 'Document navigation'})
  await sidebar.getByRole('button', {name: 'Expand Install Seed', exact: true}).click()
  await sidebar.getByRole('button', {name: 'Expand Guides', exact: true}).last().click()
  await expect(sidebar.getByRole('button', {name: 'Document Archive', exact: true})).toBeVisible()
  await expect(sidebar.getByRole('button', {name: 'Home', exact: true})).toHaveCount(1)
})
