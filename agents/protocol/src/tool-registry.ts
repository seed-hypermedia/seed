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
  memory_list: SeedToolMetadata
  memory_read: SeedToolMetadata
  memory_write: SeedToolMetadata
  memory_delete: SeedToolMetadata
  memory_download: SeedToolMetadata
  ipfs_read: SeedToolMetadata
  ipfs_write: SeedToolMetadata
  view_attachment: SeedToolMetadata
  attachment_to_memory: SeedToolMetadata
  attachment_to_ipfs: SeedToolMetadata
  memory_publish_document: SeedToolMetadata
  execute_code: SeedToolMetadata
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
    getReferencedUrls: ({output}) => {
      const results = record(output).results
      return Array.isArray(results) ? urlList(...results.map((result) => record(result).url)) : []
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
    getReferencedUrls: ({input, output}) => urlList(record(output).id, record(output).resourceUrl, record(input).id),
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
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string', description: 'One-line summary of the search outcome.'},
        query: {type: 'string'},
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
        degraded: {
          type: 'boolean',
          description: 'True when some engines were unavailable and coverage may be partial.',
        },
        unavailableEngines: {type: 'array', items: {type: 'string'}},
        markdown: {type: 'string', description: 'Human-readable rendering of the results.'},
      },
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
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string', description: 'One-line summary describing how the page was read.'},
        url: {type: 'string', description: 'The requested URL.'},
        finalUrl: {type: 'string', description: 'The URL actually read, after redirects.'},
        title: {type: 'string'},
        source: {
          type: 'string',
          enum: ['mediawiki', 'static', 'crawl4ai', 'raw'],
          description: 'Which reader tier produced the result.',
        },
        contentType: {type: 'string', description: 'Response content type. Present for raw reads.'},
        truncated: {type: 'boolean', description: 'True when the content was cut to the size limit.'},
        success: {type: 'boolean'},
        markdown: {type: 'string', description: 'The extracted markdown, or the verbatim body for raw reads.'},
      },
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
      'Create, update, and publish Seed Hypermedia documents, drafts, comments, capabilities, contacts, and profiles. Structured equivalent of seed-cli write commands. Use selected signer profileName or publicKey. For document.create and draft.create, always set the visible Seed document title as input.name (or title) / frontmatter name; the first markdown heading is body content and is not enough by itself. Do not create a document at a nested path unless its parent path already exists as a published document: to create `/team/notes`, the document at `/team` must already exist, so create parent documents first (top-level documents are always allowed). After creating, forking, copying, or editing a document, use read on the resulting document before returning block-level links because block IDs may have changed. For comment.create replies, always pass input.replyCommentId with the exact parent comment id (for trigger-created sessions, use activity.comment.id or activity.commentId.id) so the comment is threaded instead of orphaned.',
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
    getReferencedUrls: ({output}) =>
      urlList(
        record(output).id,
        record(output).commentUrl,
        record(output).target,
        record(output).targetUrl,
        record(output).authorUrl,
      ),
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_list: {
    name: 'memory_list',
    label: 'List Memory',
    description:
      'List every file and directory in your private persistent memory. Memory is a filesystem owned by this agent, shared across all of your sessions and visible to your user. Use it to recall notes, learnings, and state you stored earlier. Call this before reading or writing when you are unsure what already exists.',
    inputSchema: {type: 'object', additionalProperties: false, properties: {}},
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string', description: 'One-line summary of the memory contents.'},
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: {type: 'string', description: 'Relative path from the memory root.'},
              type: {type: 'string', enum: ['file', 'dir']},
              size: {type: 'integer', description: 'File size in bytes; 0 for directories.'},
              updatedAt: {type: 'integer', description: 'Last modification time in Unix epoch milliseconds.'},
            },
          },
        },
        totalBytes: {type: 'integer'},
      },
    },
    render: {
      kind: 'generic',
      label: 'List Memory',
      color: 'muted',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Output', source: 'output'},
        {label: 'Input', source: 'input'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_read: {
    name: 'memory_read',
    label: 'Read Memory',
    description:
      'Read one file from your private persistent memory by its relative path (for example `notes/project.md`). Text files return their full content; binary files (media, downloads) return size and MIME metadata only — use ipfs_write to publish binary files for use in Hypermedia content. Use memory_list first when you do not know the exact path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {type: 'string', minLength: 1, description: 'Relative path of the memory file to read.'},
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string'},
        encoding: {type: 'string', enum: ['utf8', 'binary']},
        content: {type: 'string', description: 'The full UTF-8 text content; absent for binary files.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
        updatedAt: {type: 'integer'},
      },
    },
    render: {
      kind: 'read',
      label: 'Read Memory',
      color: 'emerald',
      primaryArg: 'path',
      summaryArg: 'path',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Content', source: 'output', path: 'content', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_write: {
    name: 'memory_write',
    label: 'Write Memory',
    description:
      'Write one UTF-8 text file into your private persistent memory, creating parent directories automatically and replacing any existing file at that path. Use this to remember durable notes, learnings, preferences, and state across sessions. Keep files small and organized under descriptive relative paths such as `notes/topic.md`. To append or edit, read the file first and write back the full updated content.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {type: 'string', minLength: 1, description: 'Relative path of the memory file to write.'},
        content: {type: 'string', description: 'The full UTF-8 text content to store at the path.'},
      },
      required: ['path', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string'},
        size: {type: 'integer'},
        updatedAt: {type: 'integer'},
      },
    },
    render: {
      kind: 'write',
      label: 'Write Memory',
      color: 'violet',
      primaryArg: 'path',
      summaryArg: 'path',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Content', source: 'input', path: 'content', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_delete: {
    name: 'memory_delete',
    label: 'Delete Memory',
    description:
      'Delete one file, or one directory recursively, from your private persistent memory. Only delete content that is clearly obsolete or that the user asked you to remove.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {type: 'string', minLength: 1, description: 'Relative path of the memory file or directory to delete.'},
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string'},
        deleted: {type: 'boolean'},
      },
    },
    render: {
      kind: 'write',
      label: 'Delete Memory',
      color: 'amber',
      primaryArg: 'path',
      summaryArg: 'path',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_download: {
    name: 'memory_download',
    label: 'Download to Memory',
    description:
      'Download a file from a public http(s) URL into your private persistent memory. Works for any file type including binary media (images, audio, video, PDFs); the file is stored verbatim and can then be previewed by your user on the Memory tab or published with ipfs_write. For ipfs:// URLs use ipfs_read instead. Omit path to store the file under downloads/ named from the URL; when the path has no extension, one is added from the response content type. Use this instead of web_read when you need the actual file rather than extracted text.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {type: 'string', minLength: 1, description: 'The public http(s) URL of the file to download.'},
        path: {
          type: 'string',
          description: 'Optional target memory path such as media/photo.jpg. Defaults to downloads/<url filename>.',
        },
      },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string', description: 'The memory path where the file was stored.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
        finalUrl: {type: 'string', description: 'The URL actually fetched, after redirects.'},
        contentType: {type: 'string'},
      },
    },
    render: {
      kind: 'write',
      label: 'Download to Memory',
      color: 'violet',
      primaryArg: 'url',
      summaryArg: 'url',
      summaryOutputPath: 'summary',
      links: [{source: 'input', path: 'url', label: 'Source URL'}],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  ipfs_read: {
    name: 'ipfs_read',
    label: 'Read from IPFS',
    description:
      'Fetch one file from IPFS via the Hypermedia server, by CID or ipfs://<cid> URL, and save it into your private persistent memory. Use this to open ipfs:// links referenced from Hypermedia content, such as images and file attachments in documents. Omit path to store the file under ipfs/<cid>; when the path has no extension, one is added from the response content type. Text files also return their full content; process binary files with memory or code tools after fetching.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {type: 'string', minLength: 1, description: 'The IPFS CID or ipfs://<cid> URL of the file to fetch.'},
        path: {
          type: 'string',
          description: 'Optional target memory path such as media/photo.jpg. Defaults to ipfs/<cid>.',
        },
      },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string', description: 'The memory path where the file was stored.'},
        cid: {type: 'string', description: 'The IPFS content identifier that was fetched.'},
        content: {type: 'string', description: 'The full UTF-8 text content; absent for binary files.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
      },
    },
    render: {
      kind: 'read',
      label: 'Read from IPFS',
      color: 'emerald',
      primaryArg: 'url',
      summaryArg: 'url',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Content', source: 'output', path: 'content', format: 'markdown'},
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  ipfs_write: {
    name: 'ipfs_write',
    label: 'Publish to IPFS',
    description:
      'Upload one file from your private persistent memory to IPFS via the Hypermedia server, returning an ipfs://<cid> URL. Use that URL to reference the file from Hypermedia content — for example as an image in a document created with the write tool, or as a profile avatar. Works for binary media downloaded with memory_download as well as text files.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {type: 'string', minLength: 1, description: 'Relative memory path of the file to upload.'},
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        path: {type: 'string'},
        cid: {type: 'string', description: 'The IPFS content identifier.'},
        url: {type: 'string', description: 'ipfs://<cid> URL usable from Hypermedia content.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
      },
    },
    render: {
      kind: 'write',
      label: 'Publish to IPFS',
      color: 'indigo',
      primaryArg: 'path',
      summaryArg: 'path',
      summaryOutputPath: 'summary',
      links: [{source: 'output', path: 'url', label: 'IPFS file'}],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  view_attachment: {
    name: 'view_attachment',
    label: 'View Attachment',
    description:
      'Look at one file your user attached to this chat session, by the attachment id listed in the message metadata. Images are returned as actual image content you can see (when your model supports image input); other file types and oversized images return metadata plus guidance. Attachments are private to this session: use attachment_to_memory to keep one across sessions, or attachment_to_ipfs to publish one for use in Hypermedia content. Call this only when you actually need to inspect the content — the message metadata already tells you the name, type, and size.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {type: 'string', minLength: 1, description: 'The attachment id from the message metadata.'},
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        id: {type: 'string'},
        name: {type: 'string'},
        mimeType: {type: 'string'},
        size: {type: 'integer'},
        shownAsImage: {type: 'boolean', description: 'True when the image content was returned for viewing.'},
        content: {type: 'string', description: 'Full text content for UTF-8 text attachments.'},
      },
    },
    render: {
      kind: 'read',
      label: 'View Attachment',
      color: 'emerald',
      primaryArg: 'id',
      summaryArg: 'id',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
  },
  attachment_to_memory: {
    name: 'attachment_to_memory',
    label: 'Save Attachment to Memory',
    description:
      'Copy one session attachment into your private persistent memory so it survives beyond this session, using the attachment id from the message metadata. Defaults to attachments/<file name>; pass path to store it elsewhere. Do this only when the file is worth keeping across sessions — attachments are session-private by default.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {type: 'string', minLength: 1, description: 'The attachment id from the message metadata.'},
        path: {
          type: 'string',
          description: 'Optional target memory path such as media/photo.jpg. Defaults to attachments/<file name>.',
        },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        id: {type: 'string'},
        path: {type: 'string', description: 'The memory path where the attachment was stored.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
      },
    },
    render: {
      kind: 'write',
      label: 'Save Attachment to Memory',
      color: 'violet',
      primaryArg: 'id',
      summaryArg: 'id',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  attachment_to_ipfs: {
    name: 'attachment_to_ipfs',
    label: 'Publish Attachment to IPFS',
    description:
      'Publish one session attachment to IPFS via the Hypermedia server, returning an ipfs://<cid> URL usable from Hypermedia content — for example as an image in a document created with the write tool. Publishing makes the file publicly retrievable, so only do this when the user wants the file used in published content.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: {type: 'string', minLength: 1, description: 'The attachment id from the message metadata.'},
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        id: {type: 'string'},
        name: {type: 'string'},
        cid: {type: 'string', description: 'The IPFS content identifier.'},
        url: {type: 'string', description: 'ipfs://<cid> URL usable from Hypermedia content.'},
        size: {type: 'integer'},
        mimeType: {type: 'string'},
      },
    },
    render: {
      kind: 'write',
      label: 'Publish Attachment to IPFS',
      color: 'indigo',
      primaryArg: 'id',
      summaryArg: 'id',
      summaryOutputPath: 'summary',
      links: [{source: 'output', path: 'url', label: 'IPFS file'}],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  memory_publish_document: {
    name: 'memory_publish_document',
    label: 'Publish Memory Document',
    description:
      'Publish one markdown file from your private persistent memory as a Seed Hypermedia document. YAML frontmatter becomes document metadata (name, summary, icon, cover); headings, lists, tables, and code blocks become document blocks; relative image links are resolved against your memory files and uploaded to IPFS automatically. If a document already exists at the target path it is updated in place, preserving its history; otherwise a new document is created. Do not publish to a nested path unless the parent path already exists as a published document. Prefer this over the write tool when the content already lives in a memory file.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description: 'Relative memory path of the markdown file to publish, for example reports/weekly.md.',
        },
        documentPath: {
          type: 'string',
          description:
            'Target document path on the account, for example "reports/weekly", or "/" for the account home document. Defaults to a slug of the document title.',
        },
        account: {
          type: 'string',
          description:
            'Target space/account public key to publish under (requires a capability). Defaults to the signing identity account.',
        },
        name: {
          type: 'string',
          description:
            'Document title override. Defaults to the frontmatter name, or to a title derived from the file name when creating a new document.',
        },
        signer: {
          type: 'object',
          additionalProperties: false,
          properties: {profileName: {type: 'string'}, publicKey: {type: 'string'}},
          description: 'Signing identity selector; optional when exactly one signing identity is enabled.',
        },
        dryRun: {type: 'boolean', description: 'Parse and validate the file without publishing.'},
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: {type: 'string'},
        command: {type: 'string', enum: ['document.create', 'document.update']},
        id: {type: 'string', description: 'The hm:// ID of the published document.'},
        url: {type: 'string', description: 'Web URL of the published document.'},
        version: {type: 'string'},
        memoryPath: {type: 'string', description: 'The memory path that was published.'},
        imagesUploaded: {type: 'integer', description: 'Number of memory image files uploaded to IPFS.'},
      },
    },
    render: {
      kind: 'write',
      label: 'Publish Memory Document',
      color: 'indigo',
      primaryArg: 'path',
      summaryArg: 'path',
      summaryOutputPath: 'summary',
      links: [{source: 'output', path: 'url', label: 'Open document'}],
      details: [
        {label: 'Input', source: 'input'},
        {label: 'Output', source: 'output'},
      ],
    },
    getReferencedUrls: ({output}) => urlList(record(output).id),
    runtimes: ['agent-service'],
    userConfigurable: true,
  },
  execute_code: {
    name: 'execute_code',
    label: 'Execute Code',
    description:
      'Run Python or shell code in an isolated sandbox (a hardware-isolated microVM) with your persistent memory mounted at /workspace, which is also the working directory. Files your code reads and writes under /workspace are the same files as your memory_* tools and your user’s Memory tab, so use this to process, transform, analyze, or generate memory files — parse data, resize or convert media, run computations, and save results. Each call runs in a fresh sandbox: no state (variables, installed packages, processes) survives between calls, so persist anything important as files (for example install Python packages with `pip install --target /workspace/pylibs <pkg>` and add that dir to sys.path in later calls). The sandbox has internet access for fetching data and installing packages, but cannot reach private or local network addresses. Output returns stdout, stderr, the exit code, and which memory files changed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        language: {
          type: 'string',
          enum: ['python', 'shell'],
          description: 'How to run the code: "python" runs it with the python interpreter, "shell" runs it with sh.',
        },
        code: {type: 'string', minLength: 1, description: 'The code to execute.'},
        timeout_secs: {
          type: 'integer',
          minimum: 1,
          description: 'Optional timeout override in seconds. Defaults to the server limit (typically 60).',
        },
      },
      required: ['language', 'code'],
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
      primaryArg: 'language',
      summaryArg: 'language',
      summaryOutputPath: 'summary',
      details: [
        {label: 'Code', source: 'input', path: 'code'},
        {label: 'Output', source: 'output', path: 'stdout'},
        {label: 'Errors', source: 'output', path: 'stderr'},
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
}

export type SeedToolName = keyof typeof seedToolRegistry

/** Renamed tool names still present in stored agent definitions and past session events. */
export const legacySeedToolAliases: Record<string, SeedToolName> = {
  memory_upload_ipfs: 'ipfs_write',
}

/** Resolves a possibly-legacy tool name to its current registry name. */
export function normalizeSeedToolName(name: string): string {
  return legacySeedToolAliases[name] ?? name
}

export function getSeedToolMetadata(name: string): SeedToolMetadata | undefined {
  return seedToolRegistry[normalizeSeedToolName(name) as SeedToolName]
}

export function getSeedToolInputSchema(name: SeedToolName): JsonSchema {
  return seedToolRegistry[name].inputSchema
}

/** Coerces an unknown to a record so a tool extractor can read fields off it without casts. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Keeps only the non-empty strings from a list of candidate URL values. */
function urlList(...values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/** Returns the resource URLs a tool call references, via the tool's own `getReferencedUrls` extractor. */
export function getToolReferencedUrls(toolName: string, io: ToolCallIO): string[] {
  return getSeedToolMetadata(toolName)?.getReferencedUrls?.(io) ?? []
}
