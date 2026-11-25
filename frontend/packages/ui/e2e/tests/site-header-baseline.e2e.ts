import {expect, test} from '@playwright/test'

// Measurement script reused verbatim from the baseline investigation: returns
// the header's text-line-box geometry so the regression assertion can compare
// the site-name baseline against every visible nav link's baseline.
const measure = () => {
  const header = document.querySelector('header')
  const cs = (el) => getComputedStyle(el)
  const textRect = (el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const b = r.getBoundingClientRect()
    return {top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), height: +b.height.toFixed(2)}
  }
  const logoP = header.querySelector('a[data-resourceid] p')
  const logoAnchor = logoP.closest('a')
  const navLinks = Array.from(header.querySelectorAll('a')).filter(
    (a) => a !== logoAnchor && !a.closest('.pointer-events-none') && cs(a).borderBottomWidth !== '0px',
  )
  const metrics = (el) => ({
    fontSize: cs(el).fontSize,
    lineHeight: cs(el).lineHeight,
    fontFamily: cs(el).fontFamily.slice(0, 40),
    fontWeight: cs(el).fontWeight,
  })
  return {
    headerHeight: +header.getBoundingClientRect().height.toFixed(2),
    headerChildren: Array.from(header.children).map((c) => ({
      cls: String(c.className).slice(0, 70),
      h: +c.getBoundingClientRect().height.toFixed(2),
    })),
    navColumnHeight: +(header.querySelector('[class*="md:py-1"]')?.getBoundingClientRect().height ?? -1).toFixed(2),
    logo: {text: logoP.textContent, textRect: textRect(logoP), ...metrics(logoP)},
    nav: navLinks.map((a) => ({
      text: a.textContent,
      textRect: textRect(a),
      boxTop: +a.getBoundingClientRect().top.toFixed(2),
      boxHeight: +a.getBoundingClientRect().height.toFixed(2),
      padTop: cs(a).paddingTop,
      padBottom: cs(a).paddingBottom,
      borderTop: cs(a).borderTopWidth,
      borderBottom: cs(a).borderBottomWidth,
      ...metrics(a),
    })),
    baselineDeltas: navLinks.map((a) => +(textRect(a).top - textRect(logoP).top).toFixed(2)),
  }
}

test('site-name and top-navigation text share a baseline', async ({page}) => {
  // Desktop width so the nav is not `hidden md:flex`, 2x for legible geometry.
  await page.setViewportSize({width: 1280, height: 400})
  await page.goto('/site-header.html', {waitUntil: 'networkidle'})

  // Wait for the measured elements to be rendered and for webfonts to load so
  // the text-line-box geometry is final before measurement (a fixed sleep
  // neither guarantees font readiness nor stays correct on a slow machine).
  await page.locator('header a[data-resourceid] p').waitFor()
  await page
    .locator('header a')
    .filter({hasNot: page.locator('[data-resourceid]')})
    .first()
    .waitFor()
  await page.evaluate(() => document.fonts.ready)

  const data = await page.evaluate(measure)

  // Logo and every nav link must share the same font metrics, otherwise equal
  // line-box tops would not imply a shared baseline.
  for (const nav of data.nav) {
    expect(nav.fontSize, `${nav.text} fontSize`).toBe(data.logo.fontSize)
    expect(nav.lineHeight, `${nav.text} lineHeight`).toBe(data.logo.lineHeight)
    expect(nav.fontFamily, `${nav.text} fontFamily`).toBe(data.logo.fontFamily)
  }

  // Every visible nav link's text-line-box top must equal the site-name's
  // text-line-box top (within 0.5px) — i.e. the nav text is no longer 3px high.
  expect(data.nav.length).toBeGreaterThan(0)
  for (const nav of data.nav) {
    const delta = nav.textRect.top - data.logo.textRect.top
    expect(Math.abs(delta), `${nav.text} baseline delta`).toBeLessThanOrEqual(0.5)
  }
})
