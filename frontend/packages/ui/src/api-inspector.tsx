import {
  AlertCircle,
  ArrowRight,
  Binary,
  Braces,
  ChevronRight,
  Copy,
  RefreshCw,
  Search,
  Sparkles,
  TerminalSquare,
  Unplug,
} from 'lucide-react'
import {type ReactNode, useDeferredValue, useEffect, useState} from 'react'
import {
  buildApiRequestPreview,
  createStarterPayload,
  executeApiRequest,
  resolveSchemaNode,
  type ApiExecutionResult,
  type ApiSchemaDefinition,
  type ApiSchemaIndex,
  type ApiSchemaRouteSummary,
  type JSONSchemaNode,
} from '@shm/shared/api-lab'
import DataViewer from './data-viewer'
import {cn} from './utils'

type ApiInspectorProps = {
  apiHost: string
}

/** Renders a desktop-friendly API lab for inspecting and executing every local API endpoint. */
export function ApiInspector({apiHost}: ApiInspectorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [routeFilter, setRouteFilter] = useState('')
  const deferredRouteFilter = useDeferredValue(routeFilter)
  const [schemaIndex, setSchemaIndex] = useState<ApiSchemaIndex | null>(null)
  const [isIndexLoading, setIsIndexLoading] = useState(true)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [schemaDefinitions, setSchemaDefinitions] = useState<Record<string, ApiSchemaDefinition>>({})
  const [loadingDefinitionKey, setLoadingDefinitionKey] = useState<string | null>(null)
  const [definitionError, setDefinitionError] = useState<string | null>(null)
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, ApiExecutionResult>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [schemaTab, setSchemaTab] = useState<'input' | 'output'>('input')

  useEffect(() => {
    setResults({})
    setRunError(null)
  }, [apiHost])

  useEffect(() => {
    const abortController = new AbortController()

    setIsIndexLoading(true)
    setIndexError(null)
    setDefinitionError(null)
    setSchemaDefinitions({})
    setSelectedKey(null)

    fetch(buildAbsoluteUrl(apiHost, '/api/schema'), {
      signal: abortController.signal,
      headers: {Accept: 'application/json'},
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading /api/schema`)
        }
        return (await response.json()) as ApiSchemaIndex
      })
      .then((nextIndex) => {
        setSchemaIndex(nextIndex)
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return
        }
        setSchemaIndex(null)
        setIndexError(getErrorMessage(error))
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsIndexLoading(false)
        }
      })

    return () => abortController.abort()
  }, [apiHost])

  useEffect(() => {
    const routes = schemaIndex?.routes ?? []
    if (!routes.length) {
      return
    }
    if (selectedKey && routes.some((route) => route.key === selectedKey)) {
      return
    }
    setSelectedKey(routes[0]?.key ?? null)
  }, [schemaIndex, selectedKey])

  useEffect(() => {
    if (!selectedKey || schemaDefinitions[selectedKey]) {
      return
    }

    const abortController = new AbortController()

    setLoadingDefinitionKey(selectedKey)
    setDefinitionError(null)
    setSchemaTab('input')

    fetch(buildAbsoluteUrl(apiHost, `/api/schema?key=${encodeURIComponent(selectedKey)}`), {
      signal: abortController.signal,
      headers: {Accept: 'application/json'},
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} loading schema for ${selectedKey}`)
        }
        return (await response.json()) as ApiSchemaDefinition
      })
      .then((definition) => {
        setSchemaDefinitions((currentDefinitions) => ({
          ...currentDefinitions,
          [definition.key]: definition,
        }))
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return
        }
        setDefinitionError(getErrorMessage(error))
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoadingDefinitionKey(null)
        }
      })

    return () => abortController.abort()
  }, [apiHost, schemaDefinitions, selectedKey])

  const selectedDefinition = selectedKey ? schemaDefinitions[selectedKey] : undefined

  useEffect(() => {
    if (!selectedDefinition) {
      return
    }

    setDraftInputs((currentDrafts) => {
      if (currentDrafts[selectedDefinition.key] !== undefined) {
        return currentDrafts
      }

      return {
        ...currentDrafts,
        [selectedDefinition.key]: formatJsonValue(
          createStarterPayload(selectedDefinition.inputSchema, selectedDefinition.inputSchema),
        ),
      }
    })
  }, [selectedDefinition])

  const filteredRoutes = (schemaIndex?.routes ?? []).filter((route) => {
    const query = deferredRouteFilter.trim().toLowerCase()
    if (!query) {
      return true
    }

    return (
      route.key.toLowerCase().includes(query) ||
      route.path.toLowerCase().includes(query) ||
      route.kind.toLowerCase().includes(query)
    )
  })

  const selectedInput = selectedKey ? draftInputs[selectedKey] ?? '' : ''
  const selectedResult = selectedKey ? results[selectedKey] : undefined

  let previewError: string | null = null
  let preview: ReturnType<typeof buildApiRequestPreview> | undefined
  if (selectedDefinition && selectedInput) {
    try {
      preview = buildApiRequestPreview(apiHost, selectedDefinition, selectedInput)
    } catch (error) {
      previewError = getErrorMessage(error)
    }
  }

  const activeSchema =
    selectedDefinition && schemaTab === 'input' ? selectedDefinition.inputSchema : selectedDefinition?.outputSchema

  async function handleRunRequest() {
    if (!selectedDefinition || !selectedKey) {
      return
    }

    setIsRunning(true)
    setRunError(null)

    try {
      const result = await executeApiRequest(apiHost, selectedDefinition, draftInputs[selectedKey] ?? '')
      setResults((currentResults) => ({
        ...currentResults,
        [selectedKey]: result,
      }))
    } catch (error) {
      setRunError(getErrorMessage(error))
    } finally {
      setIsRunning(false)
    }
  }

  function handleRouteSelection(route: ApiSchemaRouteSummary) {
    setSelectedKey(route.key)
  }

  function handleInputReset() {
    if (!selectedDefinition) {
      return
    }

    setDraftInputs((currentDrafts) => ({
      ...currentDrafts,
      [selectedDefinition.key]: formatJsonValue(
        createStarterPayload(selectedDefinition.inputSchema, selectedDefinition.inputSchema),
      ),
    }))
    setRunError(null)
  }

  function handleFormatJson() {
    if (!selectedKey) {
      return
    }
    try {
      setDraftInputs((currentDrafts) => ({
        ...currentDrafts,
        [selectedKey]: formatJsonValue(JSON.parse(currentDrafts[selectedKey] ?? '')),
      }))
      setRunError(null)
    } catch (error) {
      setRunError(getErrorMessage(error))
    }
  }

  function handleCopyPreviewUrl() {
    if (!preview) {
      return
    }
    navigator.clipboard.writeText(preview.url)
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-h-0">
          <Panel className="flex h-full min-h-0 flex-col" contentClassName="flex min-h-0 flex-1 flex-col">
            <label className="relative block">
              <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={routeFilter}
                onChange={(event) => setRouteFilter(event.target.value)}
                placeholder="Filter by key or path"
                className="w-full rounded-xl border border-zinc-200 bg-white px-11 py-3 text-sm text-zinc-900 transition outline-none focus:border-zinc-400 focus:ring-4 focus:ring-zinc-200"
              />
            </label>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {isIndexLoading ? (
                <MutedState message="Loading /api/schema..." />
              ) : indexError ? (
                <ErrorState message={indexError} />
              ) : filteredRoutes.length ? (
                <div className="space-y-4">
                  <RouteGroup
                    title="Queries"
                    routes={filteredRoutes.filter((route) => route.kind === 'query')}
                    selectedKey={selectedKey}
                    onSelect={handleRouteSelection}
                  />
                  <RouteGroup
                    title="Actions"
                    routes={filteredRoutes.filter((route) => route.kind === 'action')}
                    selectedKey={selectedKey}
                    onSelect={handleRouteSelection}
                  />
                </div>
              ) : (
                <MutedState message="No endpoints match the current filter." />
              )}
            </div>
          </Panel>
        </aside>

        <main className="min-h-0 overflow-y-auto pr-1">
          <div className="space-y-4 pb-4">
            {selectedDefinition ? (
              <>
                <Panel
                  eyebrow="Endpoint"
                  title={selectedDefinition.key}
                  subtitle={`${selectedDefinition.method} ${selectedDefinition.path}`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill label={selectedDefinition.inputEncoding} tone="amber" />
                      <StatusPill label={selectedDefinition.outputSerialization} tone="sky" />
                      {selectedDefinition.usesParamMapping ? <StatusPill label="Mapped Params" tone="slate" /> : null}
                    </div>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetaBlock label="Method" value={selectedDefinition.method} />
                    <MetaBlock label="Request Body" value={selectedDefinition.inputEncoding} />
                    <MetaBlock
                      label="Response"
                      value={`${selectedDefinition.outputEncoding} + ${selectedDefinition.outputSerialization}`}
                    />
                  </div>
                </Panel>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
                  <Panel
                    eyebrow="Request Composer"
                    title="Input JSON"
                    subtitle="Edit the logical request payload. The API inspector derives the exact wire format from the schema."
                    actions={
                      <div className="flex flex-wrap gap-2">
                        <ActionButton onClick={handleInputReset} disabled={!selectedDefinition}>
                          <RefreshCw className="h-4 w-4" />
                          Reset
                        </ActionButton>
                        <ActionButton onClick={handleFormatJson} disabled={!selectedDefinition}>
                          <Sparkles className="h-4 w-4" />
                          Format JSON
                        </ActionButton>
                      </div>
                    }
                  >
                    <textarea
                      value={selectedInput}
                      onChange={(event) => {
                        if (!selectedKey) {
                          return
                        }
                        setDraftInputs((currentDrafts) => ({
                          ...currentDrafts,
                          [selectedKey]: event.target.value,
                        }))
                        setRunError(null)
                      }}
                      spellCheck={false}
                      className="min-h-[24rem] w-full rounded-xl border border-zinc-900/10 bg-zinc-950 px-4 py-4 font-mono text-sm leading-6 text-zinc-100 transition outline-none focus:border-zinc-400 focus:ring-4 focus:ring-zinc-200"
                    />

                    {previewError ? <InlineAlert title="Preview unavailable" message={previewError} /> : null}
                    {runError ? <InlineAlert title="Request failed" message={runError} /> : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleRunRequest}
                        disabled={!preview || isRunning}
                        className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
                      >
                        {isRunning ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <TerminalSquare className="h-4 w-4" />
                        )}
                        {isRunning ? 'Running...' : 'Run request'}
                      </button>
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <ArrowRight className="h-4 w-4" />
                        Exact transport: {selectedDefinition.method}{' '}
                        {selectedDefinition.method === 'GET' ? 'query string' : 'CBOR body'}
                      </div>
                    </div>
                  </Panel>

                  <Panel
                    eyebrow="Wire Preview"
                    title="HTTP Request"
                    subtitle="The exact request the desktop API will receive."
                    actions={
                      <ActionButton onClick={handleCopyPreviewUrl} disabled={!preview}>
                        <Copy className="h-4 w-4" />
                        Copy URL
                      </ActionButton>
                    }
                  >
                    {preview ? (
                      <div className="space-y-5">
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill label={preview.method} tone="slate" />
                            <p className="font-mono text-sm break-all text-zinc-800">{preview.url}</p>
                          </div>
                        </div>

                        <KeyValueList
                          title="Headers"
                          rows={Object.entries(preview.headers).map(([key, value]) => ({
                            key,
                            value,
                          }))}
                        />

                        {preview.method === 'GET' ? (
                          <KeyValueList
                            title="Query Params"
                            rows={preview.queryParams ?? []}
                            emptyMessage="No query params are required for this request."
                          />
                        ) : (
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                              <Binary className="h-4 w-4 text-amber-500" />
                              CBOR body
                            </div>
                            <p className="mt-3 text-sm text-zinc-600">
                              {preview.cborByteLength ?? 0} bytes generated from the current JSON payload.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <MutedState message="Select an endpoint and enter valid JSON to generate a request preview." />
                    )}
                  </Panel>
                </div>

                <Panel
                  eyebrow="Schema Guide"
                  title={schemaTab === 'input' ? 'Input Schema' : 'Output Schema'}
                  subtitle="Use the schema tree while composing requests and inspecting response structure."
                  actions={
                    <div className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 p-1">
                      <SchemaTabButton
                        label="Input"
                        isActive={schemaTab === 'input'}
                        onClick={() => setSchemaTab('input')}
                      />
                      <SchemaTabButton
                        label="Output"
                        isActive={schemaTab === 'output'}
                        onClick={() => setSchemaTab('output')}
                      />
                    </div>
                  }
                >
                  {loadingDefinitionKey === selectedDefinition.key ? (
                    <MutedState message="Loading schema detail..." />
                  ) : definitionError ? (
                    <ErrorState message={definitionError} />
                  ) : activeSchema ? (
                    <div className="space-y-4">
                      <SchemaNodeView
                        rootSchema={activeSchema}
                        schema={activeSchema}
                        name={schemaTab === 'input' ? 'input' : 'output'}
                        isRoot
                      />

                      <details className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-800">
                          Raw JSON Schema
                        </summary>
                        <pre className="overflow-x-auto border-t border-zinc-200 px-4 py-4 text-xs leading-6 text-zinc-700">
                          {formatJsonValue(activeSchema)}
                        </pre>
                      </details>
                    </div>
                  ) : (
                    <MutedState message="Schema details are not available yet." />
                  )}
                </Panel>

                <Panel
                  eyebrow="Response"
                  title="Result"
                  subtitle="Status, raw payload, and decoded output from the last request for this endpoint."
                >
                  {selectedResult ? (
                    <div className="space-y-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={`${selectedResult.status} ${selectedResult.statusText}`.trim()}
                          tone={selectedResult.ok ? 'emerald' : 'rose'}
                        />
                        <p className="text-sm text-zinc-500">
                          {selectedResult.ok ? 'Decoded with superjson.' : 'Non-2xx responses are shown raw.'}
                        </p>
                      </div>

                      <KeyValueList
                        title="Headers"
                        rows={Object.entries(selectedResult.headers).map(([key, value]) => ({
                          key,
                          value,
                        }))}
                      />

                      <div className="grid gap-4 xl:grid-cols-2">
                        <ResponseBlock
                          title="Raw Body"
                          content={
                            selectedResult.rawBody ? prettyRawBody(selectedResult.rawBody) : '(empty response body)'
                          }
                        />
                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                            <Braces className="h-4 w-4 text-sky-500" />
                            Decoded Output
                          </div>
                          <div className="mt-4 overflow-auto rounded-xl border border-white bg-white p-3">
                            {selectedResult.decodedBody !== undefined ? (
                              <DataViewer data={selectedResult.decodedBody} />
                            ) : (
                              <MutedState message="No decoded payload for this response." />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <MutedState message="Run a request to populate the response panel." />
                  )}
                </Panel>
              </>
            ) : definitionError ? (
              <ErrorState message={definitionError} />
            ) : loadingDefinitionKey ? (
              <MutedState message={`Loading schema for ${loadingDefinitionKey}...`} />
            ) : (
              <MutedState message="Choose an endpoint from the schema index to start exploring." />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function RouteGroup({
  title,
  routes,
  selectedKey,
  onSelect,
}: {
  title: string
  routes: ApiSchemaRouteSummary[]
  selectedKey: string | null
  onSelect: (route: ApiSchemaRouteSummary) => void
}) {
  if (!routes.length) {
    return null
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-[0.24em] text-zinc-500 uppercase">{title}</h2>
        <span className="text-xs text-zinc-400">{routes.length}</span>
      </div>

      <div className="space-y-2">
        {routes.map((route) => {
          const isSelected = route.key === selectedKey
          return (
            <button
              key={route.key}
              type="button"
              onClick={() => onSelect(route)}
              className={`group flex w-full items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                isSelected
                  ? 'border-zinc-300 bg-zinc-100'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900">{route.key}</span>
                  <StatusPill label={route.method} tone={route.kind === 'query' ? 'sky' : 'amber'} compact />
                </div>
                <p className="mt-2 font-mono text-xs break-all text-zinc-500">{route.path}</p>
              </div>
              <ChevronRight
                className={`mt-1 h-4 w-4 shrink-0 transition ${
                  isSelected ? 'text-zinc-600' : 'text-zinc-300 group-hover:text-zinc-500'
                }`}
              />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function SchemaNodeView({
  rootSchema,
  schema,
  name,
  required = false,
  isRoot = false,
}: {
  rootSchema: JSONSchemaNode
  schema: JSONSchemaNode
  name?: string
  required?: boolean
  isRoot?: boolean
}) {
  const resolvedSchema = resolveSchemaNode(rootSchema, schema)
  const schemaType = getSchemaType(resolvedSchema)
  const variants = resolvedSchema.oneOf ?? resolvedSchema.anyOf

  return (
    <div className={`rounded-xl border border-zinc-200 ${isRoot ? 'bg-white' : 'bg-zinc-50'} p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        {name ? (
          <code className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white">{name}</code>
        ) : null}
        {required ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold tracking-[0.16em] text-rose-700 uppercase">
            required
          </span>
        ) : null}
        {schemaType ? <SchemaBadge label={schemaType} tone="slate" /> : null}
        {resolvedSchema['x-js-type'] ? <SchemaBadge label={resolvedSchema['x-js-type']} tone="amber" /> : null}
        {resolvedSchema.contentEncoding ? (
          <SchemaBadge label={`encoding: ${resolvedSchema.contentEncoding}`} tone="sky" />
        ) : null}
      </div>

      {resolvedSchema.description ? (
        <p className="mt-3 text-sm leading-6 text-zinc-600">{resolvedSchema.description}</p>
      ) : null}

      {resolvedSchema.enum?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {resolvedSchema.enum.map((option, optionIndex) => (
            <SchemaBadge key={`${String(option)}-${optionIndex}`} label={formatInlineValue(option)} tone="emerald" />
          ))}
        </div>
      ) : null}

      {resolvedSchema.default !== undefined ? (
        <p className="mt-3 text-xs tracking-[0.18em] text-zinc-500 uppercase">
          Default{' '}
          <span className="ml-2 rounded-full bg-zinc-200 px-2 py-1 font-mono tracking-normal text-zinc-800 normal-case">
            {formatInlineValue(resolvedSchema.default)}
          </span>
        </p>
      ) : null}

      {variants?.length ? (
        <div className="mt-4 space-y-3">
          {variants.map((variant, index) => (
            <div key={`variant-${index}`} className="rounded-lg border border-dashed border-zinc-300 bg-white p-3">
              <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">Option {index + 1}</p>
              <SchemaNodeView rootSchema={rootSchema} schema={variant} name={undefined} />
            </div>
          ))}
        </div>
      ) : null}

      {(schemaType === 'object' || (!schemaType && resolvedSchema.properties)) && resolvedSchema.properties ? (
        <div className="mt-4 space-y-3">
          {Object.entries(resolvedSchema.properties).map(([propertyName, propertySchema]) => (
            <SchemaNodeView
              key={propertyName}
              rootSchema={rootSchema}
              schema={propertySchema}
              name={propertyName}
              required={resolvedSchema.required?.includes(propertyName)}
            />
          ))}
        </div>
      ) : null}

      {schemaType === 'array' ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-white p-3">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">Array Items</p>
          {Array.isArray(resolvedSchema.items) ? (
            resolvedSchema.items.map((itemSchema, index) => (
              <SchemaNodeView
                key={`array-item-${index}`}
                rootSchema={rootSchema}
                schema={itemSchema}
                name={`item ${index + 1}`}
              />
            ))
          ) : resolvedSchema.items ? (
            <SchemaNodeView rootSchema={rootSchema} schema={resolvedSchema.items} name="item" />
          ) : (
            <MutedState message="Array item schema is not specified." />
          )}
        </div>
      ) : null}

      {resolvedSchema.additionalProperties && typeof resolvedSchema.additionalProperties === 'object' ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-white p-3">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">Additional Properties</p>
          <SchemaNodeView rootSchema={rootSchema} schema={resolvedSchema.additionalProperties} name="*" />
        </div>
      ) : null}
    </div>
  )
}

function ResponseBlock({title, content}: {title: string; content: string}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <Braces className="h-4 w-4 text-amber-500" />
        {title}
      </div>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-white bg-white p-3 text-xs leading-6 text-zinc-700">
        {content}
      </pre>
    </div>
  )
}

function Panel({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  eyebrow?: string
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6', className)}>
      {eyebrow || title || subtitle ? (
        <div className="mb-5 flex flex-col gap-4 border-b border-zinc-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {eyebrow ? (
              <p className="text-xs font-semibold tracking-[0.28em] text-zinc-500 uppercase">{eyebrow}</p>
            ) : null}
            {title ? <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{title}</h2> : null}
            {subtitle ? <p className="mt-2 text-sm leading-6 text-zinc-600">{subtitle}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn('space-y-4', contentClassName)}>{children}</div>
    </section>
  )
}

function ActionButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-100 disabled:text-zinc-400"
    >
      {children}
    </button>
  )
}

function SchemaTabButton({label, isActive, onClick}: {label: string; isActive: boolean; onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        isActive ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
      }`}
    >
      {label}
    </button>
  )
}

function StatusPill({
  label,
  tone,
  compact = false,
}: {
  label: string
  tone: 'amber' | 'sky' | 'slate' | 'emerald' | 'rose'
  compact?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-[0.16em] uppercase ${getPillClasses(
        tone,
      )} ${compact ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'}`}
    >
      {label}
    </span>
  )
}

function SchemaBadge({label, tone}: {label: string; tone: 'amber' | 'sky' | 'slate' | 'emerald'}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase ${getPillClasses(
        tone,
      )}`}
    >
      {label}
    </span>
  )
}

function MetaBlock({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">{label}</p>
      <p className="mt-3 font-mono text-sm break-all text-zinc-900">{value}</p>
    </div>
  )
}

function KeyValueList({
  title,
  rows,
  emptyMessage = 'Nothing to show.',
}: {
  title: string
  rows: Array<{key: string; value: string}>
  emptyMessage?: string
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <ArrowRight className="h-4 w-4 text-sky-500" />
        {title}
      </div>
      {rows.length ? (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={`${row.key}-${row.value}`} className="rounded-lg border border-white bg-white px-3 py-2">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">{row.key}</p>
              <p className="mt-1 font-mono text-sm break-all text-zinc-800">{row.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <MutedState message={emptyMessage} />
      )}
    </div>
  )
}

function InlineAlert({title, message}: {title: string; message: string}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertCircle className="h-4 w-4" />
        {title}
      </div>
      <p className="mt-2 text-sm leading-6">{message}</p>
    </div>
  )
}

function ErrorState({message}: {message: string}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-[0.18em] uppercase">
        <Unplug className="h-4 w-4" />
        Error
      </div>
      <p className="mt-3 text-sm leading-6">{message}</p>
    </div>
  )
}

function MutedState({message}: {message: string}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm leading-6 text-zinc-500">
      {message}
    </div>
  )
}

function buildAbsoluteUrl(apiHost: string, path: string): string {
  return `${apiHost.replace(/\/+$/, '')}${path}`
}

function formatJsonValue(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatInlineValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  return String(value)
}

function prettyRawBody(rawBody: string): string {
  try {
    return JSON.stringify(JSON.parse(rawBody), null, 2)
  } catch {
    return rawBody
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPillClasses(tone: 'amber' | 'sky' | 'slate' | 'emerald' | 'rose'): string {
  switch (tone) {
    case 'amber':
      return 'bg-amber-100 text-amber-800'
    case 'sky':
      return 'bg-sky-100 text-sky-800'
    case 'emerald':
      return 'bg-emerald-100 text-emerald-800'
    case 'rose':
      return 'bg-rose-100 text-rose-800'
    case 'slate':
      return 'bg-zinc-200 text-zinc-800'
  }
}

function getSchemaType(schema: JSONSchemaNode): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((type) => type !== 'null') ?? schema.type[0]
  }
  return schema.type
}
