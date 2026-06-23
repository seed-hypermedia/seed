export type JsonSchemaTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export type JsonSchema = {
  type?: JsonSchemaTypeName | JsonSchemaTypeName[]
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  enum?: string[]
  minLength?: number
  minimum?: number
  items?: JsonSchema
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
  runtimes: ToolRuntime[]
  hidden?: boolean
  userConfigurable?: boolean
}

const readHypermediaInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description: 'hm:// URL, gateway URL, or Seed site web URL for the document/comment to read',
    },
    server: {type: 'string', description: 'Optional Seed server URL, equivalent to seed-cli --server'},
    dev: {type: 'boolean', description: 'Use the Seed devnet, equivalent to seed-cli --dev'},
    format: {type: 'string', enum: ['markdown', 'json'], description: 'Output format. Defaults to markdown.'},
  },
  required: ['id'],
} satisfies JsonSchema

const writeHypermediaInputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    command: {
      type: 'string',
      enum: [
        'draft.create',
        'draft.update',
        'draft.get',
        'draft.list',
        'draft.delete',
        'draft.publish',
        'document.create',
        'document.update',
        'document.delete',
        'document.fork',
        'document.move',
        'document.redirect',
        'document.ref',
        'comment.create',
        'comment.update',
        'comment.delete',
        'capability.create',
        'capability.grant',
        'contact.create',
        'contact.delete',
        'profile.update',
        'profile.alias',
      ],
    },
    signer: {
      type: 'object',
      additionalProperties: false,
      properties: {profileName: {type: 'string'}, publicKey: {type: 'string'}},
    },
    server: {type: 'string'},
    dev: {type: 'boolean'},
    dryRun: {type: 'boolean'},
    target: {type: 'string', description: 'Root-level alias for input.target, used by comment.create.'},
    targetId: {type: 'string', description: 'Root-level alias for input.targetId.'},
    id: {type: 'string', description: 'Root-level alias for input.id.'},
    path: {type: 'string', description: 'Root-level alias for input.path, used by document/draft commands.'},
    name: {type: 'string', description: 'Root-level alias for input.name, the Seed document title metadata.'},
    title: {type: 'string', description: 'Root-level alias for input.title, accepted as document title metadata.'},
    body: {type: 'string', description: 'Root-level alias for input.body.'},
    content: {type: 'string', description: 'Root-level alias for input.content.'},
    text: {type: 'string', description: 'Root-level alias for input.text.'},
    replyCommentId: {
      type: 'string',
      description:
        'Root-level alias for input.replyCommentId. Required for comment.create when replying to an existing comment.',
    },
    reply: {type: 'string', description: 'Root-level alias for input.reply.'},
    replyTo: {type: 'string', description: 'Root-level alias for input.replyTo.'},
    input: {
      type: 'object',
      description:
        'Command-specific input. For document.create/document.update/draft.create/draft.update use content for markdown or JSON blocks, format markdown/json, name (or title), path, metadata, edit, and location. For document.move, pass source/sourceId/id as the existing document and destination/destinationId as the full target hm:// URL; alternatively pass path (for example "/" for the account home document) and the source account will be reused. body/text are accepted as content aliases for documents and comments. For comment.create use target/targetId/id for the document, body/content/text for markdown body, and replyCommentId/reply/replyTo for the parent comment id when replying. If responding to a mention inside an activity comment, set replyCommentId to trigger_context.activity.comment.id or trigger_context.activity.commentId.id.',
      additionalProperties: true,
      properties: {
        target: {type: 'string'},
        targetId: {type: 'string'},
        id: {type: 'string'},
        path: {type: 'string'},
        name: {type: 'string'},
        title: {type: 'string'},
        body: {type: 'string'},
        content: {type: 'string'},
        text: {type: 'string'},
        format: {type: 'string', enum: ['markdown', 'json']},
        metadata: {type: 'object', additionalProperties: true},
        edit: {type: 'string'},
        location: {type: 'string'},
        replyCommentId: {type: 'string'},
        reply: {type: 'string'},
        replyTo: {type: 'string'},
      },
    },
  },
  required: ['command'],
} satisfies JsonSchema

export type SeedToolRegistry = {
  search: SeedToolMetadata
  navigate: SeedToolMetadata
  list_activity_feed: SeedToolMetadata
  read: SeedToolMetadata
  web_search: SeedToolMetadata
  web_read: SeedToolMetadata
  write: SeedToolMetadata
  set_session_title: SeedToolMetadata
}

export const seedToolRegistry: SeedToolRegistry = {
  search: {
    name: 'search',
    label: 'Search',
    description:
      'Search Hypermedia documents and contacts when you do not know the exact hm:// URL yet. Supports query, optional accountUid scoping, body/comment inclusion, match context size, search type, and page size. Use this before read or navigate when the user asks about a title, topic, or person rather than a specific URL.',
    inputSchema: {
      type: 'object',
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
          description: 'Optional match context size in runes. Defaults to 48.',
        },
        searchType: {
          type: 'string',
          enum: ['keyword', 'semantic', 'hybrid'],
          description:
            'Search strategy. Use hybrid for general discovery, keyword for exact text, semantic for concept matches.',
        },
        pageSize: {type: 'integer', minimum: 1, description: 'Maximum number of results to return.'},
      },
      required: ['query'],
      additionalProperties: false,
    },
    render: {
      kind: 'search',
      label: 'Search',
      color: 'sky',
      primaryArg: 'query',
      summaryArg: 'query',
      summaryOutputPath: 'summary',
      links: [{source: 'output', path: 'results[].url', labelPath: 'results[].title'}],
      details: [
        {label: 'Results', source: 'output', path: 'markdown', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['assistant', 'agent-service'],
    userConfigurable: true,
  },
  navigate: {
    name: 'navigate',
    label: 'Navigate',
    description:
      'Use when the user asks for navigation, opening, showing, or if the intent is strongly implied. Opens a Hypermedia resource in the app. Accepts parseable hm:// URLs, including view suffixes like /:comments, /:collaborators, /:activity/citations, and block fragments like #block or #block[5:15].',
    inputSchema: {
      type: 'object',
      properties: {
        url: {type: 'string', description: 'The hm:// URL to open'},
        newWindow: {type: 'boolean', description: 'True to open in a new window instead of the current window.'},
      },
      required: ['url'],
      additionalProperties: false,
    },
    render: {
      kind: 'navigate',
      label: 'Navigate',
      color: 'amber',
      resourceArg: 'url',
      summaryArg: 'url',
      summaryOutputPath: 'summary',
      links: [
        {source: 'output', path: 'resourceUrl', label: 'Open target'},
        {source: 'input', path: 'url', label: 'Requested URL'},
      ],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['assistant'],
  },
  list_activity_feed: {
    name: 'list_activity_feed',
    label: 'List Activity Feed',
    description:
      'Read recent Seed Hypermedia activity from the gRPC ActivityFeed/ListEvents API. Use this to observe new or recent SHM content, document updates, comments, mentions/citations, capability changes, contact changes, and other activity. Supports pagination and filters by author, resource, and event type.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pageSize: {
          type: 'integer',
          minimum: 1,
          description:
            'Maximum number of feed events to return. Use a small number such as 5-20 for recent activity. Defaults to the server/client default when omitted.',
        },
        pageToken: {
          type: 'string',
          description:
            'Pagination token returned as nextPageToken from a previous list_activity_feed call. Omit for the newest page.',
        },
        trustedOnly: {
          type: 'boolean',
          description:
            'When true, only include activity from trusted/known sources according to the underlying daemon/server policy. Defaults to false.',
        },
        filterAuthors: {
          type: 'array',
          items: {type: 'string'},
          description:
            'Optional author account UIDs to include. Use this to see activity authored by one or more specific accounts.',
        },
        filterEventType: {
          type: 'array',
          items: {type: 'string'},
          description:
            'Optional event type filters. Useful values include Ref (document update), Comment, Capability, Contact, Profile, DagPB, comment/Embed, comment/Link, comment/Target, doc/Embed, doc/Link, doc/Button, and citation/mention source types returned by the feed.',
        },
        filterResource: {
          type: 'string',
          description:
            'Optional resource filter. Use an hm:// document/account/comment resource ID to see activity related to that resource. Some callers may use a trailing * prefix form such as hm://account/path* to include child/path-related events when supported by the daemon/server.',
        },
      },
    },
    render: {
      kind: 'generic',
      label: 'Activity Feed',
      color: 'muted',
      primaryArg: 'filterResource',
      summaryArg: 'filterResource',
      summaryOutputPath: 'summary',
      links: [{source: 'input', path: 'filterResource', label: 'Filter'}],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['assistant', 'agent-service'],
    userConfigurable: true,
  },
  read: {
    name: 'read',
    label: 'Read',
    description:
      'Read Seed Hypermedia content by URL. Accepts hm:// URLs, gateway URLs, http(s) Seed site web URLs, exact block fragments such as #BLOCK_ID, and document view suffixes for comments, directories, version history, citations, and collaborators. Automatically resolves http(s) URLs before reading. Use this before returning block-level links so you can copy exact <!-- id:BLOCK_ID --> values; never invent heading-slug fragments.',
    inputSchema: readHypermediaInputSchema,
    render: {
      kind: 'read',
      label: 'Read',
      color: 'emerald',
      resourceArg: 'id',
      summaryArg: 'id',
      summaryOutputPath: 'summary',
      links: [
        {source: 'output', path: 'resourceUrl', labelPath: 'displayLabel'},
        {source: 'output', path: 'id', labelPath: 'title'},
        {source: 'input', path: 'id', label: 'Requested URL'},
      ],
      details: [
        {label: 'Content', source: 'output', path: 'markdown', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['assistant', 'agent-service'],
    userConfigurable: true,
  },
  web_search: {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the public web via a self-hosted SearXNG metasearch engine. Returns ranked results with titles, URLs, and snippets. Use this for general internet/web research when you do not already have a URL. This is NOT for Seed Hypermedia content: use search for Hypermedia documents and contacts. To read a specific web page found here, call web_read with its URL.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {type: 'string', minLength: 1, description: 'The web search query.'},
        count: {type: 'integer', minimum: 1, description: 'Maximum number of results to return. Default 10, max 25.'},
        category: {
          type: 'string',
          enum: ['general', 'news', 'science', 'it'],
          description: 'Result category. Use news for recent events, general otherwise. Defaults to general.',
        },
        time_range: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Optional recency filter for time-sensitive queries.',
        },
        language: {type: 'string', description: 'Optional language code such as en. Defaults to en.'},
      },
      required: ['query'],
    },
    render: {
      kind: 'search',
      label: 'Web Search',
      color: 'sky',
      primaryArg: 'query',
      summaryArg: 'query',
      summaryOutputPath: 'summary',
      links: [{source: 'output', path: 'results[].url', labelPath: 'results[].title'}],
      details: [
        {label: 'Results', source: 'output', path: 'markdown', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  web_read: {
    name: 'web_read',
    label: 'Web Read',
    description:
      'Fetch a single public web page (any http(s) URL) and return its main content as clean markdown. Use this to read articles, documentation, wikis, and other internet pages — including results from web_search or links the user pastes. MediaWiki/Wikipedia pages are read through the wiki API automatically. Set raw=true to return the verbatim response body instead of extracted markdown — use this for source code (e.g. raw.githubusercontent.com URLs), JSON APIs, or config files where extraction would lose information. This is NOT for Seed Hypermedia resources: use read for hm:// URLs and Seed site web URLs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {type: 'string', description: 'The public http(s) URL of the page to read.'},
        query: {
          type: 'string',
          description:
            'Optional focus query. When the page requires browser rendering, the content is filtered for relevance to this query.',
        },
        raw: {
          type: 'boolean',
          description:
            'Set true to return the raw response body (HTML, JSON, source code, plain text) verbatim with no main-content extraction or markdown conversion. Best for code files, JSON APIs, and config files.',
        },
      },
      required: ['url'],
    },
    render: {
      kind: 'read',
      label: 'Web Read',
      color: 'emerald',
      resourceArg: 'url',
      summaryArg: 'url',
      summaryOutputPath: 'summary',
      links: [
        {source: 'output', path: 'finalUrl', labelPath: 'title'},
        {source: 'input', path: 'url', label: 'Requested URL'},
      ],
      details: [
        {label: 'Content', source: 'output', path: 'markdown', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  write: {
    name: 'write',
    label: 'Write',
    description:
      'Create, update, and publish Seed Hypermedia documents, drafts, comments, capabilities, contacts, and profiles. Structured equivalent of seed-cli write commands. Use selected signer profileName or publicKey. For document.create and draft.create, always set the visible Seed document title as input.name (or title) / frontmatter name; the first markdown heading is body content and is not enough by itself. After creating, forking, copying, or editing a document, use read on the resulting document before returning block-level links because block IDs may have changed. For comment.create replies, always pass input.replyCommentId with the exact parent comment id (for trigger-created sessions, use activity.comment.id or activity.commentId.id) so the comment is threaded instead of orphaned.',
    inputSchema: writeHypermediaInputSchema,
    render: {
      kind: 'write',
      label: 'Write',
      color: 'indigo',
      primaryArg: 'command',
      summaryArg: 'command',
      summaryOutputPath: 'summary',
      links: [
        {source: 'output', path: 'url', label: 'Open result'},
        {source: 'output', path: 'resourceUrl', label: 'Open resource'},
        {source: 'input', path: 'target', label: 'Target'},
        {source: 'input', path: 'targetId', label: 'Target'},
        {source: 'input', path: 'id', label: 'ID'},
      ],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
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
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  set_session_title: {
    name: 'set_session_title',
    label: 'Set Session Title',
    description:
      'Set a concise one-line title describing the current purpose of this conversation. Update it if the purpose changes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: {
          type: 'string',
          description: 'A concise one-line session title, without trailing punctuation unless it is part of a name.',
        },
      },
      required: ['title'],
    },
    render: {kind: 'hidden', label: 'Set Session Title', color: 'hidden', primaryArg: 'title', summaryArg: 'title'},
    runtimes: ['agent-service'],
    hidden: true,
  },
  // write_file: {},
  // read_file: {},
  // exexcute_bash: {},
}

export type SeedToolName = keyof typeof seedToolRegistry

export function getSeedToolMetadata(name: string): SeedToolMetadata | undefined {
  return seedToolRegistry[name as SeedToolName]
}

export function getSeedToolInputSchema(name: SeedToolName): JsonSchema {
  return seedToolRegistry[name].inputSchema
}
