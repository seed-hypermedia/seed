import {hmId} from '@shm/shared'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {getSiteHeaderItems, isSiteHeaderItemActive, SiteHeaderMenu} from '../site-header'
import {TooltipProvider} from '../tooltip'

describe('getSiteHeaderItems', () => {
  it('prepends a fixed Home item without changing configured items', () => {
    const siteHomeId = hmId('site')
    const configured = [{key: 'about', id: hmId('site', {path: ['about']}), metadata: {name: 'About'}}]

    const items = getSiteHeaderItems(siteHomeId, configured)

    expect(items.map((item) => item.metadata.name)).toEqual(['Home', 'About'])
    expect(items[0]?.id).toMatchObject({uid: siteHomeId.uid, path: []})
    expect(configured).toHaveLength(1)
  })
})

describe('SiteHeaderMenu', () => {
  it('renders the edit control after document navigation so its appearance does not shift the links', () => {
    const siteHomeId = hmId('site')
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        {client: new QueryClient()},
        createElement(
          TooltipProvider,
          null,
          createElement(SiteHeaderMenu, {
            siteHomeId,
            docId: siteHomeId,
            items: getSiteHeaderItems(siteHomeId, [
              {key: 'about', id: hmId('site', {path: ['about']}), metadata: {name: 'About'}},
            ]),
            editNavPane: createElement('span', null, 'Edit navigation'),
          }),
        ),
      ),
    )

    expect(markup.indexOf('Home')).toBeLessThan(markup.indexOf('Edit navigation'))
    expect(markup).toContain('border-foreground')
    expect(markup).not.toContain('data-resourceid')
    expect(markup.match(/<a class="([^"]+)"[^>]*>Home/)?.[1]).not.toContain('hover:border-accent')
    expect(markup.match(/<a class="([^"]+)"[^>]*>About/)?.[1]).toContain('hover:border-accent')
  })
})

describe('isSiteHeaderItemActive', () => {
  const homeId = hmId('site')

  it('activates Home only on the root document', () => {
    const home = getSiteHeaderItems(homeId, [])[0]!

    expect(isSiteHeaderItemActive(home, homeId)).toBe(true)
    expect(isSiteHeaderItemActive(home, hmId('site', {path: ['about']}))).toBe(false)
  })

  it('activates a configured item for its nested documents', () => {
    const item = {key: 'about', id: hmId('site', {path: ['about']}), metadata: {name: 'About'}}

    expect(isSiteHeaderItemActive(item, hmId('site', {path: ['about', 'team']}))).toBe(true)
    expect(isSiteHeaderItemActive(item, hmId('site', {path: ['blog']}))).toBe(false)
  })
})
