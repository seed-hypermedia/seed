import type {BrowserCommand} from '@seed-hypermedia/agents-protocol'
import {blocksToMarkdown} from '@seed-hypermedia/client/blocks-to-markdown'
import type {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {htmlToBlocks} from '@shm/shared/html-to-blocks'
import type {WebContents} from 'electron'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {localizeBrowserArchiveImages} from './browser-archive-images'

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
export async function prepareBrowserArchive(
  page: {
    html: string
    url: string
    title: string
    metadata: Record<string, string>
  },
  localizeImages?: (blocks: HMBlockNode[]) => Promise<void>,
): Promise<BrowserArchive> {
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
  // Conversion is intermediate: no remote image reference may reach a persisted draft.
  if (localizeImages) await localizeImages(blocks)
  else await localizeBrowserArchiveImages(undefined, blocks)
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
    /** Throws when a URL the page reported is not on a website the user allowed. */
    assertOrigin?: (url: string) => void
    navigate: (url: string) => void | Promise<void>
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
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && shown(element);
    };
    // Pages can hide instructions from people while leaving them in the DOM (transparent, clipped,
    // off-page, or microscopic text). Only text a person could see on the page reaches the agent.
    const shownCache = new Map();
    const shown = (element) => {
      if (!element || element === document.documentElement || element === document.body) return true;
      if (shownCache.has(element)) return shownCache.get(element);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const clipped = /inset\\(\\s*(4[5-9]|[5-9]\\d|100)%|circle\\(\\s*0/.test(style.clipPath) || /rect\\(\\s*0(px)?,?\\s+0(px)?,?\\s+0(px)?,?\\s+0/.test(style.clip);
      const collapsed = style.display !== 'contents' && style.overflow !== 'visible' && (rect.width < 2 || rect.height < 2);
      const result = Number(style.opacity) >= 0.1 && !clipped && !collapsed && shown(element.parentElement);
      shownCache.set(element, result);
      return result;
    };
    const transparent = (color) => color === 'transparent' || /rgba\\([^)]*,\\s*0(\\.0+)?\\)$/.test(color);
    const pageWidth = Math.max(document.documentElement.scrollWidth, innerWidth);
    const pageHeight = Math.max(document.documentElement.scrollHeight, innerHeight);
    const visibleText = (root, limit) => {
      if (!root) return {text: '', truncated: false};
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const parts = [];
      let length = 0;
      let block = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.nodeValue.replace(/\\s+/g, ' ');
        if (!value.trim()) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,template,textarea,select,option')) continue;
        const style = getComputedStyle(parent);
        if (style.visibility !== 'visible' || parseFloat(style.fontSize) < 6 || transparent(style.color)) continue;
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (!range.getClientRects().length || box.width < 1 || box.height < 1) continue;
        if (box.right + scrollX <= 0 || box.bottom + scrollY <= 0 || box.left + scrollX >= pageWidth || box.top + scrollY >= pageHeight) continue;
        if (!shown(parent)) continue;
        let container = parent;
        while (container !== root && container.parentElement && /^(inline|contents)/.test(getComputedStyle(container).display)) container = container.parentElement;
        const piece = (block && block !== container ? '\\n' : '') + value;
        block = container;
        parts.push(piece);
        length += piece.length;
        if (length > limit) break;
      }
      const text = parts.join('').replace(/ *\\n */g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      return {text: text.slice(0, limit), truncated: length > limit};
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
          name: (el.getAttribute('aria-label') || (el.labels && [...el.labels].map(l => visibleText(l, 300).text).join(' ')) || visibleText(el, 300).text || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 300),
          ...(el.tagName === 'A' ? {url: el.href.slice(0, 10000)} : {}),
          disabled: el.matches(':disabled,[aria-disabled=true]'),
          inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth});
      }
      const {text, truncated} = visibleText(document.body, 80000);
      return {summary: 'Read current webpage (untrusted content)', document: state.document, url: location.href, title: document.title.slice(0, 1000), metadata,
        text, truncated, elements,
        viewport: {width: innerWidth, height: innerHeight, scrollX, scrollY},
        limitations: 'Main document only; cross-origin frames and closed shadow roots are not included. Only text visible on the page is included. Form values are not read.'};
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
      if (command.action === 'click') {
        const submits = (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.form && ['submit', 'image'].includes(el.type);
        if (submits && new URL(el.formAction || location.href, document.baseURI).origin !== location.origin) throw new Error('This button submits the form to another website. Ask the user to submit it.');
        el.click();
      }
      else {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly || (el instanceof HTMLInputElement && !['text','search','email','url','tel','number'].includes(el.type))) throw new Error('Typing requires an editable text input or textarea. Password fields are for the user to fill in.');
        if (el.autocomplete && /(^|\\s)(current-password|new-password|one-time-code|cc-number|cc-csc)(\\s|$)/.test(el.autocomplete)) throw new Error('This field holds a secret. Ask the user to fill it in.');
        const action = el.form ? new URL(el.form.getAttribute('action') || location.href, document.baseURI) : null;
        if (action && action.origin !== location.origin) throw new Error('This field submits to another website (' + action.origin + '). Ask the user to fill it in.');
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
  // The page can navigate while the script runs; never return content from a website the user did not allow.
  options.assertOrigin?.(typeof result.url === 'string' ? result.url : '')
  options.assertActive()
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
    await options.navigate(command.url)
    return {summary: 'Requested navigation; take a fresh snapshot after the page loads', url: command.url}
  }
  if (command.action === 'archive') {
    const archive = await prepareBrowserArchive(result, (blocks) => localizeBrowserArchiveImages(guest, blocks))
    options.assertActive()
    const draft = await options.archive(archive)
    return {
      summary: `Created editable draft: ${archive.metadata.name}`,
      draftId: draft.id,
      url: result.url,
      metadata: archive.metadata,
      markdown: archive.markdown,
      limitations:
        'Article content imported; images are stored locally or replaced with source links. Scripts, forms, frames and interactive behavior are not archived.',
    }
  }
  return result
}
