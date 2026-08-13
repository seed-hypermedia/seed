/**
 * The Seed agent tool surface: five always-on verbs plus a directory of callable tools.
 *
 * The model-facing surface is the five verbs — read, write, call, delegate, plan — plus the
 * hidden return_result mechanism for typed child sessions. Everything that used to be its own
 * tool (memory, ipfs, attachments, web reading, the activity feed, hypermedia writes, spawning,
 * todos) is an address form of a verb or a callable tool dispatched through `call`.
 *
 * Callable tools keep the same metadata shape but are NOT exposed as provider tools: `call`
 * validates input against the target's schema, and calling an unexpanded or mis-called tool
 * returns the tool's contract as the result (touch-expand) instead of erroring.
 */

export type JsonSchemaTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export type JsonSchema = {
  type?: JsonSchemaTypeName | JsonSchemaTypeName[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  enum?: string[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: JsonSchema
  minItems?: number
  maxItems?: number
}

export type ToolRuntime = 'assistant' | 'agent-service'

export type ToolRenderKind = 'search' | 'read' | 'resolve' | 'navigate' | 'write' | 'generic' | 'hidden'

export type ToolRenderValueSource = 'input' | 'output'

export type ToolRenderLink = {
  source: ToolRenderValueSource
  path: string
  label?: string
  labelPath?: string
}

/** Input and output of a single tool call, passed to a tool's reference extractor. */
export type ToolCallIO = {input?: unknown; output?: unknown}

export type ToolRenderDetail = {
  label: string
  source: ToolRenderValueSource
  path?: string
  format?: 'json' | 'markdown'
}

export type ToolRenderCustomView = {
  command: string
  kind: 'write-command'
}

export type ToolRenderMetadata = {
  kind: ToolRenderKind
  label: string
  pendingLabel?: string
  color: 'sky' | 'emerald' | 'violet' | 'amber' | 'indigo' | 'muted' | 'hidden'
  primaryArg?: string
  resourceArg?: string
  summaryArg?: string
  summaryOutputPath?: string
  links?: ToolRenderLink[]
  details?: ToolRenderDetail[]
  customViews?: ToolRenderCustomView[]
}

export type SeedToolMetadata = {
  name: string
  label: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  render: ToolRenderMetadata
  /** Returns the hm:// resource URLs this tool call references, so referenced content can be synced. */
  getReferencedUrls?: (io: ToolCallIO) => string[]
  runtimes: ToolRuntime[]
  hidden?: boolean
  userConfigurable?: boolean
}

// ---------------------------------------------------------------------------------------------
// The five verbs
// ---------------------------------------------------------------------------------------------

const readVerb = {
  name: 'read',
  label: 'Read',
  description: [
    'Read anything you can address. One verb for your whole world; the address shape picks the source:',
    '- `~/memory/<path>` — a file in your persistent memory. A directory path (or `~/memory/`) lists entries with sizes.',
    '- `~/tools/<name>` — a tool contract: full description plus input/output schemas. `~/tools/` lists every tool you can call.',
    '- `hm://…` (or a Seed gateway/site URL) — a hypermedia document or comment, as markdown by default.',
    '- `ipfs://<cid>` — fetch content by CID into memory and return it (binary files return metadata only).',
    '- `https://…` — read a public web page as markdown.',
    '- `activity:` — the recent activity feed; filter with options {authors, eventTypes, resource, pageSize, pageToken}.',
    '- `attachment:<id>` — a file attached to this conversation (images are shown to you when the model supports it).',
    '- `thread:<id>` — another conversation transcript of yours. `run:<id>` — a run journal.',
    'Directory listings return {entries: [{path, type, size}]}; memory file reads return {content}. Prefer reading exactly what you need; directory listings are cheap, whole trees are not.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      address: {
        type: 'string',
        minLength: 1,
        description:
          'What to read: ~/memory/…, ~/tools/…, hm://…, ipfs://…, https://…, activity:, attachment:<id>, thread:<id>, run:<id>.',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'Output format where supported. Defaults to markdown.',
      },
      options: {
        type: 'object',
        description:
          'Source-specific options: activity filters {authors, eventTypes, resource, pageSize, pageToken}; ipfs {path} to choose the memory destination.',
      },
    },
    required: ['address'],
  },
  render: {
    kind: 'read',
    label: 'Read',
    pendingLabel: 'Reading',
    color: 'sky',
    primaryArg: 'address',
    summaryArg: 'address',
    resourceArg: 'address',
    summaryOutputPath: 'summary',
    details: [{label: 'Content', source: 'output'}],
  },
  getReferencedUrls: (io: ToolCallIO) => {
    const input = io.input as {address?: unknown} | undefined
    const address = typeof input?.address === 'string' ? input.address : ''
    return address.startsWith('hm://') ? [address] : []
  },
  runtimes: ['assistant', 'agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const writeVerb = {
  name: 'write',
  label: 'Write',
  description: [
    'Write anything you can address. The address shape picks the destination:',
    '- `~/memory/<path>` — write `content` to a memory file (parent folders are created automatically; writing an existing file replaces its whole content — there is no append). Options: {delete: true} removes a file or directory; {fromUrl} downloads a URL to the path instead of writing content; {fromAttachment: "<id>"} saves a conversation attachment to the path.',
    '- `ipfs://` — publish to IPFS and get a CID URL back. Provide {fromPath: "~/memory/<path>"} or {fromAttachment: "<id>"} in options.',
    '- `hm://<account>/<path>` — publish a hypermedia document with markdown `content`. The default creates a NEW document; pass {action: "update"} to revise an existing document in place (same address, new version). Other options: {title} sets the visible document title (a # heading is body content, not the title); {metadata} sets document metadata attributes as an object (e.g. {summary, icon, cover, or custom keys}) — metadata belongs here, never in the body text; {signer} picks the signing identity by profileName or publicKey; {action} also covers "comment" (with {target, replyTo}), "move" (with {toPath}), "redirect" (with {toUrl}), "delete", "fork" (with {fromUrl}). Unrecognized option keys are refused, not ignored. Parent documents must exist before nested paths.',
    'Writing to hm:// publishes signed content other people can see — be sure the content is ready.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      address: {
        type: 'string',
        minLength: 1,
        description: 'Where to write: ~/memory/<path>, ipfs://, or hm://<account>/<path>.',
      },
      content: {
        type: 'string',
        description: 'The content to write. Markdown for hm:// documents; raw text for memory files.',
      },
      options: {
        type: 'object',
        description: 'Destination-specific options; read ~/tools/write for the full contract per address form.',
      },
    },
    required: ['address'],
  },
  render: {
    kind: 'write',
    label: 'Write',
    pendingLabel: 'Writing',
    color: 'emerald',
    primaryArg: 'address',
    summaryArg: 'address',
    resourceArg: 'address',
    summaryOutputPath: 'summary',
    details: [
      {label: 'Content', source: 'input', path: 'content', format: 'markdown'},
      {label: 'Options', source: 'input', path: 'options'},
      {label: 'Result', source: 'output'},
    ],
    // Command-keyed rich views: old transcripts carry `command` in the tool input; new write-verb
    // results carry it in the output (writeToolResult), so both render the purpose-built UI.
    customViews: [
      {command: 'draft.create', kind: 'write-command'},
      {command: 'draft.update', kind: 'write-command'},
      {command: 'draft.get', kind: 'write-command'},
      {command: 'draft.list', kind: 'write-command'},
      {command: 'draft.delete', kind: 'write-command'},
      {command: 'draft.publish', kind: 'write-command'},
      {command: 'document.create', kind: 'write-command'},
      {command: 'document.update', kind: 'write-command'},
      {command: 'document.delete', kind: 'write-command'},
      {command: 'document.fork', kind: 'write-command'},
      {command: 'document.move', kind: 'write-command'},
      {command: 'document.redirect', kind: 'write-command'},
      {command: 'document.ref', kind: 'write-command'},
      {command: 'comment.create', kind: 'write-command'},
      {command: 'comment.update', kind: 'write-command'},
      {command: 'comment.delete', kind: 'write-command'},
      {command: 'capability.create', kind: 'write-command'},
      {command: 'capability.grant', kind: 'write-command'},
      {command: 'contact.create', kind: 'write-command'},
      {command: 'contact.delete', kind: 'write-command'},
      {command: 'profile.update', kind: 'write-command'},
      {command: 'profile.alias', kind: 'write-command'},
    ],
  },
  getReferencedUrls: (io: ToolCallIO) => {
    const input = io.input as {address?: unknown} | undefined
    const output = io.output as Record<string, unknown> | undefined
    const id = typeof output?.id === 'string' ? output.id : undefined
    const version = typeof output?.version === 'string' ? output.version : undefined
    const versionedId = id && version ? `${id}${id.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : id
    return [
      input?.address,
      versionedId,
      output?.url,
      output?.resourceUrl,
      output?.commentUrl,
      output?.target,
      output?.targetUrl,
      output?.authorUrl,
      output?.destination,
    ].filter((value): value is string => typeof value === 'string' && value.startsWith('hm://'))
  },
  runtimes: ['assistant', 'agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const callVerb = {
  name: 'call',
  label: 'Call',
  description: [
    'Invoke a tool by name with a JSON input. Your available tools are listed in your context with one-line summaries; read `~/tools/<name>` for a full contract.',
    'Calling a tool with missing or invalid input does not fail: the result is the tool contract itself — read it and call again correctly. Do not guess elaborate inputs for a tool you have not expanded.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tool: {type: 'string', minLength: 1, description: 'The tool name, as listed under ~/tools/.'},
      input: {type: 'object', description: "The tool's input, matching its contract."},
    },
    required: ['tool'],
  },
  render: {
    kind: 'generic',
    label: 'Call',
    pendingLabel: 'Calling',
    color: 'amber',
    primaryArg: 'tool',
    summaryArg: 'tool',
    summaryOutputPath: 'summary',
    details: [
      {label: 'Input', source: 'input', path: 'input'},
      {label: 'Result', source: 'output'},
    ],
  },
  runtimes: ['assistant', 'agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const delegateVerb = {
  name: 'delegate',
  label: 'Delegate',
  description: [
    'Spawn a child run to do work for you. Two kinds of child, one verb:',
    '- A **model child** (default): pass `brief` — human-readable markdown that becomes the child conversation\'s first message VERBATIM. The user reviews it as the child\'s full context, so write a real briefing: goal, all needed background, expectations, data in fenced blocks. The child is a fresh context and never sees this conversation; it does share your persistent memory when it runs as you. Pass `prompt` for an anonymous worker persona or `agentId` to run one of your other agents; pass `tools` only to narrow its toolset. Declare `output` (a JSON schema, root type "object") to get a validated structured result; otherwise you get its final text.',
    '- A **script child**: pass `script` — a JavaScript module `export default async function (input, ctx) {…}` that orchestrates tools with real control flow (loops, parallel fan-out, durable sleeps). No imports, Date, Math.random, setTimeout, or fetch; everything external goes through ctx: `ctx.call(tool, input, {description})` — where tool is the read or write verb or any callable tool, and description is a short human-readable label for what this call is doing (shown live to the user; always provide one) — `ctx.delegate({...})` for nested model children (resolves DIRECTLY to the validated output object, or {text} when no output schema was declared; throws a coded error on failure), `ctx.parallel([...thunks])` (array of zero-arg functions, resolves to results in the same order), `ctx.sleep(ms)`, `ctx.waitForEvent(match, {timeoutMs, label})` — parks until something happens and resolves with the payload, or null on timeout; match `{signal: "approved"}` for a person or system answering this run, or `{eventType, resource, author}` for the activity feed — `ctx.continueAsNew(state)` — ends this run and starts a successor carrying only `state`, for loops that would otherwise run forever; nothing after it executes — `ctx.step(label, fn)`, `ctx.plan({steps})`, `ctx.now()`, `ctx.log(...)`, `ctx.progress(...)`, `ctx.input`, `ctx.runId`. Scripts run durably: they survive restarts and completed steps never re-execute; a parked wait costs nothing while it waits. Pass `input` for the JSON value handed to the module.',
    "Independent children must be spawned TOGETHER: emit every delegate call for a batch in ONE reply, before you have any of their results. Two delegate calls in one reply run at the same time; the same two calls spawned in consecutive replies run one after the other and take twice as long. Asked to research two topics, reply with two delegate calls at once — do NOT delegate one, wait for its result, then delegate the other. Sequence children only when a later child genuinely needs an earlier one's output. Your turn then pauses (cheaply — parked, restart-proof) until every child spawned this turn resolves, and each delegate call receives its own result, so parallel children never mix up. Beyond about two parallel items, prefer a script child with `ctx.parallel`: it fans out deterministically and keeps the whole fan-out in one reviewable place. Pass `await: false` only for fire-and-forget work whose outcome you do not need.",
    'Keep a plan. Before a parallel batch, mark ONE step running that names the whole batch (e.g. "Research both competitors"); every child spawned in that reply attaches to it. Never re-delegate work a completed child already did — check the children you already have before spawning. Do NOT delegate work you can simply do yourself, and never delegate just to make one tool call.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {type: 'string', description: 'Short label for the child, shown in the thread list and progress card.'},
      brief: {
        type: 'string',
        description:
          "Model child: the task brief as human-readable markdown; becomes the child's first message verbatim. Provide exactly one of brief or script.",
      },
      script: {
        type: 'string',
        description:
          'Script child: a self-contained module `export default async function (input, ctx) {…}`. Provide exactly one of brief or script.',
      },
      input: {description: 'Script child only: JSON value passed to the module as its first argument.'},
      prompt: {
        type: 'string',
        description:
          'Model child: optional system prompt for an anonymous worker using your model. Omit to run the child as yourself; provide at most one of prompt or agentId.',
      },
      agentId: {type: 'string', description: 'Model child: run under another of your agents by id.'},
      tools: {
        type: 'array',
        items: {type: 'string'},
        description: 'Model child: restrict the child to these tools (intersected with what its agent has).',
      },
      output: {
        type: 'object',
        description:
          'Model child: JSON schema for the required result (root type "object"). The child delivers it via return_result; validation errors bounce back for self-correction.',
      },
      await: {
        type: 'boolean',
        description:
          'Default true: your turn parks until the child resolves and you receive its result. false: detached — the child runs in the background and you never receive its outcome.',
      },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: {type: 'string', enum: ['succeeded', 'failed', 'canceled', 'detached']},
      sessionId: {type: 'string'},
      runId: {type: 'string'},
      output: {
        description:
          "The validated result payload, {text} when no output schema was declared, or the script's return value.",
      },
      error: {type: 'object', properties: {code: {type: 'string'}, message: {type: 'string'}}},
    },
  },
  render: {
    kind: 'write',
    label: 'Delegate',
    pendingLabel: 'Delegating',
    color: 'violet',
    primaryArg: 'title',
    summaryArg: 'title',
    // The full account of a delegation, for any surface without a purpose-built view: what the
    // child was asked to do, the code if it was a script child, and what came back. (The desktop
    // bubble renders the brief and the child's own run hierarchy instead, and keeps the raw
    // payloads behind its info dialog.) Absent fields render nothing.
    details: [
      {label: 'Brief', source: 'input', path: 'brief', format: 'markdown'},
      {label: 'Script', source: 'input', path: 'script'},
      {label: 'Input', source: 'input', path: 'input'},
      {label: 'Result', source: 'output'},
    ],
  },
  runtimes: ['agent-service'],
  userConfigurable: false,
} satisfies SeedToolMetadata

const planVerb = {
  name: 'plan',
  label: 'Plan',
  description:
    "Maintain the visible plan for the current task. Call this when starting any task with 3 or more distinct steps (declare them all as pending, then mark the first running), and again whenever a step's status changes: running when you begin it, done when finished, failed if it cannot complete, skipped if no longer needed. Keep step labels short and outcome-oriented. Send the full current list each time; it replaces the previous plan. The user sees this as a live checklist and can act on it, so keeping it current is part of doing the task well. Plan BEFORE delegating: children spawned while a step is running attach under it — one step can own a whole parallel batch.",
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {type: 'string', description: 'Optional one-line name for the overall task.'},
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {type: 'string', description: 'Stable id for the step (e.g. "s1"), kept across updates.'},
            label: {type: 'string', minLength: 1, description: 'Short description of the step.'},
            status: {type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped']},
          },
          required: ['id', 'label', 'status'],
        },
      },
    },
    required: ['steps'],
  },
  render: {kind: 'hidden', label: 'Plan', color: 'hidden', summaryArg: 'title'},
  runtimes: ['agent-service'],
} satisfies SeedToolMetadata

const returnResultTool = {
  name: 'return_result',
  label: 'Return Result',
  description:
    'Deliver the final structured result of this delegated task. Call this exactly once when the task is complete; the payload must match the required schema. This ends your task.',
  // The real parameters are the spawner-declared output schema, swapped in at session start.
  inputSchema: {type: 'object'},
  render: {
    kind: 'generic',
    label: 'Return Result',
    color: 'emerald',
    details: [{label: 'Result', source: 'input'}],
  },
  runtimes: ['agent-service'],
} satisfies SeedToolMetadata

/** The always-on model-facing surface: the five verbs plus the hidden child-result mechanism. */
export const seedVerbRegistry = {
  read: readVerb,
  write: writeVerb,
  call: callVerb,
  delegate: delegateVerb,
  plan: planVerb,
  return_result: returnResultTool,
} as const

export type SeedVerbName = keyof typeof seedVerbRegistry

// ---------------------------------------------------------------------------------------------
// Callable tools — dispatched through `call`, never exposed as provider tools directly
// ---------------------------------------------------------------------------------------------

const searchTool = {
  name: 'search',
  label: 'Search',
  description:
    'Search Seed hypermedia content: document titles, contacts, and optionally document bodies and comments. Returns ranked results with hm:// URLs you can read.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {type: 'string', minLength: 1, description: 'The search query. Supports phrases and wildcards.'},
      accountUid: {type: 'string', description: 'Optional account UID to scope search to a single account.'},
      includeBody: {
        type: 'boolean',
        description: 'Set true to search document bodies and comments in addition to titles and contacts.',
      },
      contextSize: {
        type: 'integer',
        minimum: 0,
        maximum: 512,
        description: 'Optional match context size in runes. Defaults to 48.',
      },
      searchType: {
        type: 'string',
        enum: ['keyword', 'semantic', 'hybrid'],
        description: 'Search ranking mode. Defaults to hybrid.',
      },
      pageSize: {type: 'integer', minimum: 1, description: 'Maximum number of results to return.'},
    },
    required: ['query'],
  },
  render: {
    kind: 'search',
    label: 'Search',
    color: 'sky',
    primaryArg: 'query',
    summaryOutputPath: 'summary',
    links: [{source: 'output', path: 'results[].url', labelPath: 'results[].title'}],
    details: [
      {label: 'Results', source: 'output', path: 'markdown', format: 'markdown'},
      {label: 'Input', source: 'input'},
    ],
  },
  runtimes: ['assistant', 'agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const webSearchTool = {
  name: 'web_search',
  label: 'Web Search',
  description:
    'Search the public web. Returns ranked results with titles, URLs, and snippets; read a result with `read` on its URL. Use the news category for recent events.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {type: 'string', minLength: 1, description: 'The web search query.'},
      count: {type: 'integer', minimum: 1, description: 'Maximum number of results to return. Default 10, max 25.'},
      category: {
        type: 'string',
        enum: ['general', 'news'],
        description: 'Result category. Use news for recent events, general otherwise. Defaults to general.',
      },
      timeRange: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Optional recency filter for time-sensitive queries.',
      },
      language: {type: 'string', description: 'Optional language code such as en. Defaults to en.'},
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: {type: 'string', description: 'One-line summary of the search outcome.'},
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: {type: 'string'},
            url: {type: 'string'},
            snippet: {type: 'string'},
            engine: {type: 'string', description: 'Upstream engine that produced the result.'},
          },
        },
      },
      partial: {type: 'boolean', description: 'True when some engines were unavailable and coverage may be partial.'},
      markdown: {type: 'string', description: 'Human-readable rendering of the results.'},
    },
  },
  render: {
    kind: 'search',
    label: 'Web Search',
    color: 'sky',
    primaryArg: 'query',
    summaryOutputPath: 'summary',
    links: [{source: 'output', path: 'results[].url', labelPath: 'results[].title'}],
    details: [
      {label: 'Results', source: 'output', path: 'markdown', format: 'markdown'},
      {label: 'Input', source: 'input'},
    ],
  },
  runtimes: ['assistant', 'agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const navigateTool = {
  name: 'navigate',
  label: 'Navigate',
  description: 'Open an hm:// URL in the app so the user is looking at it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: {type: 'string', description: 'The hm:// URL to open'},
      newWindow: {type: 'boolean', description: 'True to open in a new window instead of the current window.'},
    },
    required: ['url'],
  },
  render: {
    kind: 'navigate',
    label: 'Navigate',
    color: 'muted',
    primaryArg: 'url',
    resourceArg: 'url',
  },
  getReferencedUrls: (io: ToolCallIO) => {
    const input = io.input as {url?: unknown} | undefined
    return typeof input?.url === 'string' && input.url.startsWith('hm://') ? [input.url] : []
  },
  runtimes: ['assistant'],
  userConfigurable: true,
} satisfies SeedToolMetadata

const executeTool = {
  name: 'execute',
  label: 'Execute Code',
  description:
    'Run TypeScript, Python, or shell code in an isolated sandbox (a hardware-isolated microVM) with your persistent memory mounted at /workspace, which is also the working directory. Files your code reads and writes under /workspace are the same files as your ~/memory addresses, so use this to process, transform, analyze, or generate memory files — parse data, resize or convert media, run computations, and save results. Each call runs in a fresh sandbox: no state (variables, installed packages, processes) survives between calls, so persist anything important as files (for example install Python packages with `pip install --target /workspace/pylibs <pkg>` and add that dir to sys.path in later calls). The sandbox has internet access for fetching data and installing packages, but cannot reach private or local network addresses. Output returns stdout, stderr, the exit code, and which memory files changed.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      runtime: {
        type: 'string',
        enum: ['ts', 'python', 'shell'],
        description:
          'How to run the code: "ts" runs TypeScript with bun, "python" runs it with the python interpreter, "shell" runs it with sh. Read ~/tools/execute for the runtimes this server actually offers — the list there is authoritative.',
      },
      code: {type: 'string', minLength: 1, description: 'The code to execute.'},
      timeout_secs: {
        type: 'integer',
        minimum: 1,
        description: 'Optional timeout override in seconds. Defaults to the server limit (typically 60).',
      },
    },
    required: ['runtime', 'code'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: {type: 'string'},
      exitCode: {type: 'integer'},
      success: {type: 'boolean'},
      stdout: {type: 'string'},
      stderr: {type: 'string'},
      truncated: {type: 'boolean', description: 'True when stdout/stderr was cut to the size limit.'},
      durationMs: {type: 'integer'},
      changedFiles: {
        type: 'array',
        description: 'Memory files added, modified, or removed by the execution.',
        items: {
          type: 'object',
          properties: {
            path: {type: 'string'},
            change: {type: 'string', enum: ['added', 'modified', 'removed']},
          },
        },
      },
    },
  },
  render: {
    kind: 'write',
    label: 'Execute Code',
    color: 'amber',
    primaryArg: 'runtime',
    summaryArg: 'runtime',
    summaryOutputPath: 'summary',
    details: [
      {label: 'Code', source: 'input', path: 'code'},
      {label: 'Output', source: 'output', path: 'stdout'},
      {label: 'Errors', source: 'output', path: 'stderr'},
    ],
  },
  runtimes: ['agent-service'],
  userConfigurable: true,
} satisfies SeedToolMetadata

/** Tools reachable through the `call` verb (and scripts' ctx.call), keyed by name. */
export const callableToolRegistry = {
  search: searchTool,
  web_search: webSearchTool,
  navigate: navigateTool,
  execute: executeTool,
} as const

export type CallableToolName = keyof typeof callableToolRegistry

// ---------------------------------------------------------------------------------------------
// Combined lookup
// ---------------------------------------------------------------------------------------------

/**
 * Every known tool, verbs and callables together, keyed by name. This is the lookup surface for
 * renderers and validation; the provider-facing toolset is `seedVerbRegistry` alone.
 */
export const seedToolRegistry = {
  ...seedVerbRegistry,
  ...callableToolRegistry,
} as const

export type SeedToolName = keyof typeof seedToolRegistry

/**
 * Renamed callable tools still present in stored agent definitions. Names absorbed into verbs
 * (memory_*, web_read, ipfs_*, attachment_*, spawn tools, …) intentionally have no mapping:
 * the verbs are always on, so those entries in old tool arrays are simply inert.
 */
const legacyCallableAliases: Record<string, string> = {
  execute_code: 'execute',
}

/** Resolves a possibly-legacy tool name to its current registry name. */
export function normalizeSeedToolName(name: string): string {
  return legacyCallableAliases[name] ?? name
}

export function getSeedTool(name: string): SeedToolMetadata | undefined {
  return (seedToolRegistry as Record<string, SeedToolMetadata>)[normalizeSeedToolName(name)]
}

/** hm:// URLs a tool call references, from the registry's structured reference extractors. */
export function getToolReferencedUrls(toolName: string, io: ToolCallIO): string[] {
  return getSeedTool(toolName)?.getReferencedUrls?.(io) ?? []
}

/** One-line summary for a tool, used by the ~/tools listing and the call description. */
export function toolSummaryLine(tool: SeedToolMetadata): string {
  const firstSentence = tool.description.split(/(?<=\.)\s/, 1)[0] ?? tool.description
  return `${tool.name} — ${firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence}`
}

/** Renders a tool's full contract as markdown, returned by touch-expand and ~/tools reads. */
export function toolContractMarkdown(tool: SeedToolMetadata): string {
  const parts = [
    `# ${tool.name}`,
    '',
    tool.description,
    '',
    '## Input schema',
    '```json',
    JSON.stringify(tool.inputSchema, null, 2),
    '```',
  ]
  if (tool.outputSchema) {
    parts.push('', '## Output schema', '```json', JSON.stringify(tool.outputSchema, null, 2), '```')
  }
  return parts.join('\n')
}
