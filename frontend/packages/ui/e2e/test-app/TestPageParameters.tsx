import React, {useEffect, useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createDocumentPageInput} from '@shm/shared/document-page-input'
import {pageParamsFromUrl} from '@seed-hypermedia/client/page-input'
import type {SchemaFetchClient} from '@seed-hypermedia/client/schema-resolve'
import {Button} from '../../src/button'
import {OptionsDropdown} from '../../src/options-dropdown'
import {DocumentPageParameters} from '../../src/document-page-parameters'
import {TooltipProvider} from '../../src/tooltip'
import '../../../../apps/web/app/tailwind.css'

/** Exercise the real parameter form, validator and browser history without a daemon. */
function TestPageParameters() {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const input = useMemo(
    () =>
      createDocumentPageInput({
        schema: new URLSearchParams(location.search).get('schema') || 'hm://hyper.media/example/person',
        client: {} as SchemaFetchClient,
        params: pageParamsFromUrl(location.href),
        navigate: (params, mode) => {
          const url = new URL(location.href)
          Array.from(url.searchParams.keys())
            .filter((key) => key.startsWith('p.'))
            .forEach((key) => url.searchParams.delete(key))
          Object.entries(params).forEach(([key, value]) => url.searchParams.set(`p.${key}`, value))
          if (mode === 'push') history.pushState(null, '', url)
          else history.replaceState(null, '', url)
        },
      }),
    [],
  )
  useEffect(() => {
    input.start()
    const receive = () => input.update(pageParamsFromUrl(location.href))
    const unsubscribe = input.subscribe((state) => setValues(state.values))
    void input.read().then((state) => setValues(state.values))
    window.addEventListener('popstate', receive)
    return () => {
      unsubscribe()
      input.close()
      window.removeEventListener('popstate', receive)
    }
  }, [input])
  return (
    <TooltipProvider>
      <main className="bg-background text-foreground min-h-screen p-6">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Page parameters
        </Button>
        <OptionsDropdown
          ariaLabel="Page options"
          menuItems={[{key: 'page-parameters', label: 'Page parameters', onClick: () => setOpen(true)}]}
        />
        <pre data-testid="page-input" className="mt-4">
          {JSON.stringify(values)}
        </pre>
        {open && <DocumentPageParameters input={input} onClose={() => setOpen(false)} />}
      </main>
    </TooltipProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TestPageParameters />
  </React.StrictMode>,
)
