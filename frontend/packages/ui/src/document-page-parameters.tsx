import {useEffect, useRef, useState} from 'react'
import {encodePageInput} from '@seed-hypermedia/client/page-input'
import type {createDocumentPageInput, DocumentPageInputState} from '@shm/shared/document-page-input'
import {Button} from './button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from './components/dialog'
import {SchemaDataEditor, seedValue} from './schema/data-editor'
import {resolveSchema, structFields, validate} from './schema/engine'

type PageInput = ReturnType<typeof createDocumentPageInput>
type Contract = Awaited<ReturnType<PageInput['contract']>>

/** Edit the page's schema-defined URL input without restarting its runtime. */
export function DocumentPageParameters({input, onClose}: {input: PageInput; onClose: () => void}) {
  const [returnFocus] = useState(() => document.activeElement)
  const pendingWrite = useRef<AbortController>()
  useEffect(() => () => pendingWrite.current?.abort(), [])
  const [contract, setContract] = useState<Contract>()
  const [values, setValues] = useState<unknown>({})
  const [incomingErrors, setIncomingErrors] = useState<string[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let changed = false
    setError('')
    const receive = (state: DocumentPageInputState) => {
      setValues(state.values)
      setIncomingErrors(state.errors)
      setGeneration((value) => value + 1)
    }
    const unsubscribe = input.subscribe((state) => {
      changed = true
      receive(state)
    })
    void Promise.all([input.contract(controller.signal), input.read(undefined, controller.signal)])
      .then(([loaded, state]) => {
        if (controller.signal.aborted) return
        setContract(loaded)
        if (!changed) receive(state)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [input, attempt])

  const errors = contract ? validate(contract.schema, values, '$', {}, contract.registry) : []
  try {
    encodePageInput(values)
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause))
  }
  const resolved = contract && resolveSchema(contract.schema, {}, contract.registry).schema
  const empty = resolved && structFields(resolved).length === 0 && !resolved.values

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
            event.preventDefault()
            returnFocus.focus()
          }
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>Page parameters</DialogTitle>
          <DialogDescription>Adjust this view. Your choices are included in the page link.</DialogDescription>
        </DialogHeader>
        {!contract && !error && (
          <p role="status" className="text-muted-foreground text-sm">
            Loading parameters…
          </p>
        )}
        {error && (
          <div role="alert" className="text-destructive text-sm">
            {error}
            {!contract && (
              <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
            )}
          </div>
        )}
        {contract && (
          <form
            className="flex flex-col gap-5"
            onSubmit={async (event) => {
              event.preventDefault()
              if (saving || errors.length) return
              setSaving(true)
              setError('')
              try {
                const controller = new AbortController()
                pendingWrite.current = controller
                await input.write(values, 'push', controller.signal)
                onClose()
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
              } finally {
                setSaving(false)
              }
            }}
          >
            {empty ? (
              <p className="text-muted-foreground py-4 text-sm">This page has no parameters to edit.</p>
            ) : (
              <fieldset disabled={saving} className="min-w-0">
                <SchemaDataEditor
                  key={generation}
                  schema={contract.schema}
                  registry={contract.registry}
                  value={values}
                  onValue={(value) => {
                    setValues(value)
                    setIncomingErrors([])
                    setError('')
                  }}
                />
              </fieldset>
            )}
            {(errors.length > 0 || incomingErrors.length > 0) && (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
              >
                <p className="font-medium">Check these parameters</p>
                <ul className="mt-1 list-disc pl-4">
                  {Array.from(new Set([...errors, ...incomingErrors])).map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="border-border flex items-center justify-between gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setValues(seedValue(contract.schema, contract.registry))
                  setIncomingErrors([])
                  setError('')
                  setGeneration((value) => value + 1)
                }}
              >
                Reset
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {empty ? 'Close' : 'Cancel'}
                </Button>
                <Button variant="default" type="submit" disabled={saving || errors.length > 0}>
                  {saving ? 'Applying…' : 'Apply'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
