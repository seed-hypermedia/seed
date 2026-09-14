import type {BrowserCommand} from '@seed-hypermedia/agents-protocol'
import {blocksToMarkdown} from '@seed-hypermedia/client/blocks-to-markdown'
import type {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {htmlToBlocks} from '@shm/shared/html-to-blocks'
import type {WebContents} from 'electron'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'

const documentToken = z.string().min(1).max(100)
const ref = z.string().min(1).max(100)
const commandSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('snapshot')}),
  z.object({action: z.literal('screenshot'), document: documentToken}),
  z.object({action: z.literal('click'), document: documentToken, ref}),
  z.object({
    action: z.literal('type'),
    document: documentToken,
    ref,
    text: z.string().max(20000),
    clear: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('press'),
    document: documentToken,
    key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp']),
  }),
  z.object({
    action: z.literal('scroll'),
    document: documentToken,
    x: z.number().min(-10000).max(10000).optional(),
    y: z.number().min(-10000).max(10000),
  }),
  z.object({action: z.literal('navigate'), document: documentToken, url: z.string().url().max(10000)}),
  z.object({action: z.literal('archive'), document: documentToken}),
])

/** Editable article capture; no scripts, local paths, cookies, or form values are exported. */
export type BrowserArchive = {metadata: HMMetadata; blocks: HMBlockNode[]; markdown: string}

/** Converts sanitized article HTML into the same editable blocks and markdown used by Seed documents. */
export async function prepareBrowserArchive(page: {
  html: string
  url: string
  title: string
  metadata: Record<string, string>
}): Promise<BrowserArchive> {
  const capturedAt = new Date().toISOString()
  const metadata: HMMetadata = {
    name: page.title || new URL(page.url).hostname,
    ...(page.metadata.description ? {summary: page.metadata.description} : {}),
    sourceUrl: page.url,
    sourceCapturedAt: capturedAt,
    ...(page.metadata.canonicalUrl ? {sourceCanonicalUrl: page.metadata.canonicalUrl} : {}),
    ...(page.metadata.author ? {sourceAuthor: page.metadata.author} : {}),
    ...(page.metadata.publishedAt ? {sourcePublishedAt: page.metadata.publishedAt} : {}),
    ...(page.metadata.language ? {sourceLanguage: page.metadata.language} : {}),
  }
  const blocks = await htmlToBlocks(page.html, '', {
    resolveImage: async (src) => (/^https?:\/\//.test(src) ? src : null),
  })
  if (!blocks.length) throw new Error('This page has no article content to archive')
  const attribution = `Source: ${page.url} · Captured ${capturedAt}`
  blocks.push({
    block: {
      id: randomUUID().replace(/-/g, '').slice(0, 10),
      type: 'Paragraph',
      text: attribution,
      annotations: [{type: 'Link', link: page.url, starts: [8], ends: [8 + Array.from(page.url).length]}],
      attributes: {},
    },
    children: [],
  })
  const markdown = blocksToMarkdown({content: blocks, metadata} as HMDocument, {ipfsGateway: false})
  return {metadata, blocks, markdown}
}

/** Runs a bounded browser command in an isolated world, with references tied to the last observed document. */
export async function executeBrowserCommand(
  guest: WebContents,
  raw: BrowserCommand,
  options: {
    assertActive: () => void
    navigate: (url: string) => void
    archive: (archive: BrowserArchive) => Promise<{id: string}>
  },
): Promise<Record<string, unknown>> {
  const command = commandSchema.parse(raw)
  options.assertActive()
  if (!/^https?:\/\//.test(guest.getURL())) throw new Error('Open a website before using browser tools')
  const result = await guest.executeJavaScriptInIsolatedWorld(1002, [
    {
      code: `(() => { try {
    const command = ${JSON.stringify(command)};
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.slice(0, 4000) || '';
    const canonical = document.querySelector('link[rel~=canonical]')?.href;
    const metadata = {
      description: meta('meta[name=description],meta[property="og:description"]'),
      author: meta('meta[name=author],meta[property="article:author"]'),
      publishedAt: meta('meta[property="article:published_time"],meta[name=date]'),
      canonicalUrl: canonical && /^https?:/.test(canonical) ? canonical.slice(0, 10000) : '', language: document.documentElement.lang.slice(0, 100)
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    if (command.action === 'snapshot') {
      const state = {document: ${JSON.stringify(randomUUID())}, url: location.href, refs: new Map()};
      globalThis.__seedBrowser = state;
      const elements = [];
      for (const el of document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true],[tabindex]')) {
        if (elements.length >= 250) break;
        if (!visible(el)) continue;
        const ref = 'e' + (elements.length + 1);
        state.refs.set(ref, el);
        const rect = el.getBoundingClientRect();
        elements.push({ref, role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || (el.labels && [...el.labels].map(l => l.innerText).join(' ')) || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 300),
          ...(el.tagName === 'A' ? {url: el.href.slice(0, 10000)} : {}),
          disabled: el.matches(':disabled,[aria-disabled=true]'),
          inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth});
      }
      const text = document.body?.innerText || '';
      return {summary: 'Read current webpage (untrusted content)', document: state.document, url: location.href, title: document.title.slice(0, 1000), metadata,
        text: text.slice(0, 80000), truncated: text.length > 80000, elements,
        viewport: {width: innerWidth, height: innerHeight, scrollX, scrollY},
        limitations: 'Main document only; cross-origin frames and closed shadow roots are not included. Form values are not read.'};
    }
    const state = globalThis.__seedBrowser;
    if (!state || state.document !== command.document || state.url !== location.href) throw new Error('Page changed. Take a fresh snapshot before acting.');
    if (command.action === 'archive') {
      const root = document.querySelector('article') || document.querySelector('main,[role=main]') || document.body;
      const clone = root.cloneNode(true);
      const originals = [...root.querySelectorAll('*')];
      [...clone.querySelectorAll('*')].forEach((el, i) => {
        const style = getComputedStyle(originals[i]);
        if (style.display === 'none' || style.visibility === 'hidden') el.remove();
        if (originals[i] instanceof HTMLImageElement && originals[i].currentSrc) el.setAttribute('src', originals[i].currentSrc);
      });
      clone.querySelectorAll('script,style,noscript,iframe,object,embed,form,input,textarea,select,button,nav,[hidden],[aria-hidden=true]').forEach(el => el.remove());
      for (const el of clone.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (!['href','src','alt','title','colspan','rowspan'].includes(attr.name)) el.removeAttribute(attr.name);
        }
        for (const name of ['href', 'src']) {
          const raw = el.getAttribute(name);
          if (!raw) continue;
          try {
            const url = new URL(raw, document.baseURI);
            if ((name === 'href' ? ['http:', 'https:', 'hm:'] : ['http:', 'https:']).includes(url.protocol)) el.setAttribute(name, url.href);
            else el.removeAttribute(name);
          } catch { el.removeAttribute(name); }
        }
        if (el.tagName === 'IMG' && !el.hasAttribute('src')) el.remove();
      }
      const html = clone.innerHTML;
      if (html.length > 1000000) throw new Error('This article is too large to archive in one capture');
      return {html, url: location.href, title: document.title.slice(0, 1000), metadata};
    }
    if (command.action === 'click' || command.action === 'type') {
      const el = state.refs.get(command.ref);
      if (!el?.isConnected || !visible(el) || el.matches(':disabled,[aria-disabled=true]')) throw new Error('Element is unavailable. Take a fresh snapshot.');
      el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!hit || !(el === hit || el.contains(hit))) throw new Error('Element is covered. Inspect the page before clicking or typing.');
      if (command.action === 'click') el.click();
      else {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || (el instanceof HTMLInputElement && !['text','search','email','url','tel','password','number'].includes(el.type))) throw new Error('Typing requires an editable text input or textarea');
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, command.clear === false ? el.value + command.text : command.text);
        el.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: command.text}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
      }
    }
    if (command.action === 'scroll') window.scrollBy({left: command.x || 0, top: command.y, behavior: 'instant'});
    return {summary: 'Browser ' + command.action + ' completed', url: location.href, title: document.title};
  } catch (error) { return {browserError: String(error.message || error)}; } })()`,
    },
  ])
  if (result.browserError) throw new Error(result.browserError)
  if (command.action === 'screenshot') {
    options.assertActive()
    const capture = await guest.capturePage()
    options.assertActive()
    const size = capture.getSize()
    const image = size.width > 1280 ? capture.resize({width: 1280}) : capture
    return {
      ...result,
      summary: 'Captured webpage viewport',
      screenshot: {mimeType: 'image/jpeg', data: image.toJPEG(75).toString('base64')},
      dimensions: image.getSize(),
    }
  }
  if (command.action === 'press') {
    options.assertActive()
    guest.focus()
    guest.sendInputEvent({type: 'keyDown', keyCode: command.key})
    guest.sendInputEvent({type: 'keyUp', keyCode: command.key})
  }
  if (command.action === 'navigate') {
    options.assertActive()
    options.navigate(command.url)
    return {summary: 'Requested navigation; take a fresh snapshot after the page loads', url: command.url}
  }
  if (command.action === 'archive') {
    const archive = await prepareBrowserArchive(result)
    options.assertActive()
    const draft = await options.archive(archive)
    return {
      summary: `Created editable draft: ${archive.metadata.name}`,
      draftId: draft.id,
      url: result.url,
      metadata: archive.metadata,
      markdown: archive.markdown,
      limitations:
        'Article content imported; external images still reference the source site. Scripts, forms, frames and interactive behavior are not archived.',
    }
  }
  return result
}
