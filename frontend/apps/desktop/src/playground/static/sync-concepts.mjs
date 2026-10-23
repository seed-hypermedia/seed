import {escapeHTML as esc} from './ui.mjs'

/** Definitions and stable anchors shared by the workbench and the published Starlight HM26 explanations. */
export const syncConcepts = {
  guide: {
    title: 'Read the sync graph',
    summary: 'Start with one resource. Read downward from its selected version to the bytes it needs.',
    detail:
      'Both peer diagrams use the same positions. A solid card means bytes are held; a dashed card is a teaching outline from the observer catalog, not an advertisement received by that peer. An amber outline means the peer has discovered work to fetch. A check means the entire containment subtree is locally complete. Green highlighting marks the current step. Content and permission evidence are separate views. Try the shared-DAG example, step through one request and response, then inspect the SQL changes.',
    page: 'syncing-guide',
    block: 'sy83ca68',
  },
  peer: {
    title: 'Peer',
    summary: 'One device with its own byte store and derived indexes.',
    detail:
      'The playground gives each peer one principal and independent SQL-shaped tables. A real device can hold multiple identities sharing a physical byte store, but queries and network disclosure still require the caller’s own authority.',
    page: 'syncing-guide',
    block: 'sy2ffc1d',
  },
  principal: {
    title: 'Principal',
    summary: 'A signing identity; knowing who someone is does not grant access.',
    detail:
      'Hello authenticates identity in the simulator. Resource rights come from validated grants and root trust, separately from transport identity. Private signing keys are never part of the graph or replicated SQL tables.',
    page: 'syncing-guide',
    block: 'sy69e037',
  },
  resource: {
    title: 'Resource policy',
    summary: 'The boundary where read, write and admin rights are evaluated.',
    detail:
      'The playground’s resource card represents its proposed root/public policy. Its Ref card represents a selected version. This split is pedagogical: the HM26 schema identifies a resource by its initial resource blob CID. Moving a resource under a parent does not inherit that parent’s permissions.',
    page: 'authority-model',
    block: 'sy5de953',
  },
  authority: {
    title: 'Permissions',
    summary: 'Evidence answering who may read, write or administer this exact resource.',
    detail:
      'Switch to Permissions to inspect policy, grants and revocations without mixing them into the content tree. Arrows point from an evidence blob to the proof it depends on. A proof card being stored does not itself establish a valid grant; the world authority evaluator supplies that decision.',
    page: 'authority-model',
    block: 'sy8f76fd',
  },
  grant: {
    title: 'Grant',
    summary: 'A signed capability giving a principal a role on a resource.',
    detail:
      'The tentative roles are reader, writer and irrevocable admin. A grant depends on its issuer’s admin proof. Reader/writer grants are independently revocable by a same-scope admin; permanent admin ancestry is not revoked. Rights from independent active grants combine.',
    page: 'capability',
    block: 'sy3492ad',
  },
  revocation: {
    title: 'Revocation',
    summary: 'A signed fact revoking one reader or writer grant.',
    detail:
      'Revocation changes future serving decisions when learned. It does not delete old bytes from another device or recall copies. The simulator stops an active run when its world changes and clears authority caches; immutable bytes stay.',
    page: 'revocation',
    block: 'sy2a3c5f',
  },
  proof: {
    title: 'Proof edge',
    summary: 'This evidence depends on another authority fact.',
    detail:
      'Read an arrow as “needs this proof.” The resource policy anchors the root, admin grants prove delegation, and reader/writer grants depend on authorized admins. Proof edges do not add content to a download frontier.',
    page: 'authority-model',
    block: 'syc1cda2',
  },
  ref: {
    title: 'Ref · selected version',
    summary: 'The version declaration chosen for this resource.',
    detail:
      'In the teaching model a Ref links to its payload or change heads and separately to authority evidence. It is a simulator label, not an additional adopted HM26 wire type. The published resource union defines the candidate signed version shapes. Matching Ref addresses is not enough: the receiver can still be missing descendants.',
    page: 'resource',
    block: 'sy3ff6c0',
  },
  manifest: {
    title: 'Manifest · packing list',
    summary: 'A small immutable block listing the addresses of its children.',
    detail:
      'A manifest contains child addresses, not all their bytes. Read its arrows as “needs these blocks.” The playground splits supplied text into paragraph chunks and packs them in a balanced binary tree. A real format and chunking strategy remain experimental. Manifests with identical encoded children can be shared across resources; this does not share permission.',
    page: 'syncing-guide',
    block: 'sy05b3ab',
  },
  chunk: {
    title: 'Chunk · actual content',
    summary: 'A leaf block holding a piece of the supplied content.',
    detail:
      'In the shared example, “Shared methods” and “Shared observations” are equal bytes in two resources. They therefore reuse chunk addresses and can reuse their manifest. A leaf with verified bytes has no more containment dependencies to fetch. The simulator chunks by paragraphs; it does not implement production file chunking.',
    page: 'syncing-guide',
    block: 'sy6c87f6',
  },
  change: {
    title: 'Change',
    summary: 'An immutable signed edit with explicit predecessor dependencies.',
    detail:
      'A selected change-bearing version points to change heads. Each change can depend on multiple earlier changes. The simulator walks valid same-resource dependencies; missing, cross-resource and cyclic dependencies stay unresolved and prevent a completion receipt. Application ordering and the immutable apply contract are separate HM26 design questions.',
    page: 'change',
    block: 'sy12ea12',
  },
  blob: {
    title: 'Immutable blob',
    summary: 'Bytes identified by their content; editing them produces a different address.',
    detail:
      'Ref, manifest, chunk and authority cards are all blobs in the teaching catalog. A local byte store keeps one physical copy of equal blobs. Authorization depends on their admitted resource context and evidence, not simply on having or naming their address.',
    page: 'syncing-guide',
    block: 'syfa2c8c',
  },
  cid: {
    title: 'CID · content address',
    summary: 'An identifier used to verify that received bytes are the bytes requested.',
    detail:
      'Production CIDs describe codec/hash identity. The playground uses SHA-256 labels over its JSON serialization, not production CID encoding or canonical DAG-CBOR signatures. Human names in the UI resolve these addresses; the raw simulation still uses them as keys.',
    page: 'syncing-guide',
    block: 'sy542462',
  },
  dag: {
    title: 'DAG · dependency graph',
    summary: 'Boxes are immutable blocks. An arrow says “this block needs that block.”',
    detail:
      'DAG means directed acyclic graph. It is allowed to have shared children: two packing lists may point to the same chunk, so the structure is not necessarily a tree. Content and permission proof edges have different meanings and appear in separate views. Ordinary references are excluded from automatic download closure.',
    page: 'syncing-guide',
    block: 'sy512d0f',
  },
  contains: {
    title: 'Containment edge',
    summary: 'Follow this arrow to obtain content required by the selected version.',
    detail:
      'Only admitted containment edges expand the resource frontier. Ref to payload, manifest to child, and valid change to dependency are examples. A mention, navigation link or proof edge does not automatically make its target content readable.',
    page: 'syncing-guide',
    block: 'sybeeb20',
  },
  reference: {
    title: 'Reference',
    summary: 'A link to another object without an automatic right to fetch it.',
    detail:
      'An ordinary mention or placement link is not a containment edge. A bare CID cannot launder a private blob into a new audience. Origin-verified publication and current scope authority are still required.',
    page: 'syncing-guide',
    block: 'sy52367a',
  },
  stored: {
    title: 'Stored bytes',
    summary: 'This peer has verified this block’s bytes. Its children may still be missing.',
    detail:
      'A solid box records local storage. It is deliberately weaker than a completeness check. In the partial preset Bob already has the selected head, yet must still fetch its required descendants.',
    page: 'syncing-guide',
    block: 'sy87b04e',
  },
  complete: {
    title: 'Complete subtree',
    summary: 'This block and every required containment descendant are present locally.',
    detail:
      'A check mark caches a local traversal result under fixed rules. It is not permission, a claim of globally latest state, or proof that every revocation is known. Complete subtrees can be skipped without revisiting every leaf. This experiment pins completed closures; a real garbage collector must invalidate affected ancestor markers before evicting descendants.',
    page: 'syncing-guide',
    block: 'syeebbf6',
  },
  missing: {
    title: 'Not held · observer outline',
    summary: 'An outline helps compare the two peers without moving boxes around.',
    detail:
      'The UI knows the world catalog, but a peer does not. A gray outline is not proof that this peer knows the block’s address. Only frontier rows represent discovered outstanding work. For a peer without current read access, unheld private outlines are suppressed. The exact RPC payload is the source of truth about what crosses the wire.',
    page: 'syncing-guide',
    block: 'syffa635',
  },
  active: {
    title: 'Active this step',
    summary: 'The highlighted blocks participate in this request, response or local operation.',
    detail:
      'Requests do not store bytes. Responses can store blocks and extend the frontier. A local walk can inspect or skip a subtree without sending any RPC. The current event and SQL panel explain which of these happened; color alone does not imply transfer.',
    page: 'syncing-guide',
    block: 'sy968796',
  },
  scope: {
    title: 'Scope',
    summary: 'The resource context admitted for this exchange.',
    detail:
      'OpenScope follows control validation. The simulated scope is exact-resource and tied to the world revision; it is not blanket permission to request arbitrary CIDs. The older peer proposal also describes children/recursive scopes, whose members each need independent authorization.',
    page: 'peer-rpc',
    block: 'sy5f161c',
  },
  revision: {
    title: 'Revision fence',
    summary: 'A freshness check that prevents an old scope from serving after relevant changes.',
    detail:
      'The simulator uses a world digest and invalidates a run on any world edit. That is coarser than a production per-resource authority revision. A frozen data view never freezes permission. Stale authority cache rows cannot grant access.',
    page: 'resource-index',
    block: 'sy2b214d',
  },
  privacy: {
    title: 'Possession privacy',
    summary: 'Skipping local content can reveal that a peer already has those bytes.',
    detail:
      'Reuse complete subtrees minimizes transfer but reveals request patterns. Uniform scoped traversal fetches the offered closure even when bytes are local; physical storage still deduplicates. This experiment demonstrates one disclosure tradeoff, not a complete traffic-analysis defense.',
    page: 'syncing-guide',
    block: 'sya4cc6b',
  },
  rbsr: {
    title: 'RBSR · set reconciliation',
    summary: 'Compare scoped sets to discover differences without sending the entire set each time.',
    detail:
      'The previous RPC proposal reconciles allowed blob CIDs. The playground instead compares selected resource heads and then walks their containment DAGs. Its implementation uses ordinary set comparison as a stand-in; it does not measure actual RBSR fingerprints, network round trips or algorithm costs.',
    page: 'peer-rpc',
    block: 'sy25c722',
  },
  rpc: {
    title: 'RPC · peer message',
    summary: 'A request to the other peer and its corresponding response.',
    detail:
      'Step advances through requests, responses and local work separately. Only the displayed RPC payload crosses the simulated wire. Every trace row has a separate documentation link, while its main button rewinds to the recorded event. The following playground methods are an experiment layered alongside the earlier tentative contract.',
    page: 'peer-rpc',
    block: 'sy8e1941',
  },
  Hello: {
    title: 'Hello',
    summary: 'Establish who the two peers are.',
    detail:
      'The simulator combines both directions of authentication into one request/response pair and reports the two principals. The earlier contract splits Hello and Authenticate with connection-bound challenges and signatures. The simulator does not perform that cryptography. Authentication does not grant any resource access.',
    page: 'peer-rpc',
    block: 'sy185f8d',
  },
  GetControl: {
    title: 'GetControl',
    summary: 'Exchange the authority evidence needed for shared resources.',
    detail:
      'Each direction sends only evidence available to the sender for resources both principals can read, including participant/writer proof ancestry. Unrelated membership stays local. The playground omits some production recovery flows: the earlier contract permits a revoked reader to retrieve narrow personal revocation evidence even without content access.',
    page: 'peer-rpc',
    block: 'sy74806c',
  },
  OpenScope: {
    title: 'OpenScope',
    summary: 'Agree which exact resource may be exchanged at this revision.',
    detail:
      'A response records fresh principal/resource read decisions in authority_cache. It does not send content and does not inherit child permissions. In the simulator both peers must have read authority, and world edits invalidate the run. Production scope IDs, leases, watch cursors and recursive membership stamps remain part of the richer earlier proposal.',
    page: 'peer-rpc',
    block: 'sy708110',
  },
  ReconcileHeads: {
    title: 'ReconcileHeads',
    summary: 'Compare selected resource versions before traversing their content.',
    detail:
      'The sender offers its scoped resource head. The receiver records it and seeds frontier, even if the head address matches local storage: matching heads do not prove complete descendants. This is an experimental alternative to ReconcileBlobs, not an endpoint declared in the earlier protobuf. Ordinary set comparison stands in for RBSR.',
    page: 'peer-rpc',
    block: 'sy5009a4',
  },
  FetchBlock: {
    title: 'FetchBlock',
    summary: 'Request one missing block through its admitted resource and parent.',
    detail:
      'The request carries a resource/revision plus a CID and admitted parent (or accepted head). The response returns the block only when live authority, frontier membership and sender availability all pass. Missing and inaccessible cases use UNAVAILABLE; no completion receipt follows an incomplete closure. The receiver verifies bytes, stores them once and extends frontier through containment edges. This one-block teaching operation corresponds to the earlier FetchBlobs streaming proposal.',
    page: 'peer-rpc',
    block: 'sydbe6db',
  },
  walk: {
    title: 'Walk · local operation',
    summary: 'Check whether a subtree is complete, partly present or missing.',
    detail:
      'No RPC is sent by the walk itself. A complete subtree can be skipped with one cache lookup; a stored incomplete block expands its containment children; a missing block queues FetchBlock. Uniform transfer intentionally bypasses local reuse to demonstrate possession privacy.',
    page: 'sync-workflows',
    block: 'sy7a6c4f',
  },
  Commit: {
    title: 'Commit · local operation',
    summary: 'Confirm the entire required closure before acknowledging it.',
    detail:
      'Walk the admitted containment graph bottom-up. Only a fully present, valid closure receives complete markers. Clear resolved frontier rows, then commit. Missing or rejected dependencies leave the run incomplete and prevent Ack. This is an in-memory transaction illustration, not a durable database engine.',
    page: 'sync-workflows',
    block: 'sy82a9c4',
  },
  Ack: {
    title: 'Ack',
    summary: 'Tell the serving peer that this selected closure committed locally.',
    detail:
      'After Commit succeeds, Ack causes the serving peer to record a resource/head/revision receipt. It is an illustrative explicit acknowledgement, not an endpoint in the earlier protobuf. Its INDEXED label means complete closure in this simulator; the earlier OfferBlobs/GetOfferStatus contract has richer validation and indexing stages. Neither guarantees every replica has the content or that authority will remain valid.',
    page: 'peer-rpc',
    block: 'syde2e9f',
  },
  blocked: {
    title: 'Stopped or incomplete',
    summary: 'The run cannot safely continue or cannot finish this closure.',
    detail:
      'A world change invalidates cached authority and stops further exchange. An offline peer stops transport. An unavailable or invalid dependency leaves unresolved frontier and prevents acknowledgement. Retained immutable bytes remain visible; rebuild replicas to start a fresh experiment.',
    page: 'sync-workflows',
    block: 'sy6973dd',
  },
  sql: {
    title: 'Local SQL state',
    summary: 'Seven small tables make the per-peer storage and cache decisions visible.',
    detail:
      'These arrays simulate proposed tables; no SQLite engine runs. Immutable bytes and typed edges are durable-source concepts. Authority decisions, selected heads, completeness, outstanding frontier and receipts have different lifetimes and must not be conflated. The larger SQL proposal above includes additional provenance, sessions, watches, outbox and recovery machinery.',
    page: 'resource-index',
    block: 'sy4ec7c5',
  },
  blobs: {
    title: 'blobs table',
    summary: 'One row per locally stored, hash-verified immutable block.',
    detail:
      'cid is the primary key; kind and byte count describe the block, and verified records hash verification. This teaching row does not contain the physical data column: bytes live in the simulator catalog. Production storage must persist the bytes and validation facts.',
    page: 'resource-index',
    block: 'sy3aa3a9',
  },
  edges: {
    title: 'edges table',
    summary: 'Typed parent-to-child links extracted from stored blocks.',
    detail:
      'The composite primary key (parent, child, kind) prevents duplicate edges; the child index supports reverse lookups. contains edges extend content work, proof edges describe evidence, reference edges do not authorize transfer. A parent row may name a child whose bytes are still missing.',
    page: 'resource-index',
    block: 'syf394aa',
  },
  authority_cache: {
    title: 'authority_cache table',
    summary: 'Current read decisions for a principal and resource, tagged with revision.',
    detail:
      'The key is (principal, resource), with revision and can_read columns. It caches a derived decision, not permanent permission. OpenScope populates it; world changes clear it before any further response. Production invalidation should track relevant resource changes and current serving fences.',
    page: 'resource-index',
    block: 'sye8dcb1',
  },
  resource_heads: {
    title: 'resource_heads table',
    summary: 'Which version address a peer currently associates with a resource.',
    detail:
      'The resource primary key selects one head plus its revision in this experiment. A reconciled advertised head may arrive before its bytes or closure. This is sync bookkeeping, not proof of fully verified, rendered state. Real concurrent version selection and eligibility require the richer resource index.',
    page: 'resource-index',
    block: 'syb762c1',
  },
  complete_table: {
    title: 'complete table',
    summary: 'Cached local closure checks keyed by content address and traversal rules.',
    detail:
      '(cid, rules) is the primary key. Rules identify the dependency semantics used to establish completeness. Bytes shared across resources can reuse this physical fact, while access is always checked separately. Pinning or invalidation on eviction is required to keep positive markers truthful.',
    page: 'resource-index',
    block: 'sy146a1c',
  },
  frontier: {
    title: 'frontier table',
    summary: 'Discovered blocks that still need checking or fetching in this resource.',
    detail:
      'The key is (resource, cid); parent records the edge admitting the request, or an empty value for an accepted head. ReconcileHeads seeds it, walk and FetchBlock expand or resolve it, and successful Commit clears the completed resource. Unlike gray observer outlines, these rows represent work the peer actually knows about.',
    page: 'resource-index',
    block: 'syc75752',
  },
  receipts: {
    title: 'receipts table',
    summary: 'Acknowledgements recorded by the serving peer after the receiver commits.',
    detail:
      'The simulator key is (resource, head), with revision. The real publication contract needs peer/request/body identity, durable status transitions and retry recovery as described above. A receipt is a past fact about a particular recipient and version; it is not ongoing permission or global replication.',
    page: 'resource-index',
    block: 'sy3619a1',
  },
  Authenticate: {
    title: 'Authenticate',
    summary: 'Prove control of a principal on the current connection.',
    detail:
      'The earlier contract uses a one-use challenge and client signature. Tokens are connection-bound authentication hints, never resource access grants. The playground folds this into Hello and does not simulate cryptographic validation.',
    page: 'peer-rpc',
    block: 'sy221286',
  },
  ReconcileBlobs: {
    title: 'ReconcileBlobs',
    summary: 'The earlier proposal compares the allowed blob CID set for a scope.',
    detail:
      'RBSR fingerprints and ranges must be filtered before disclosure and fenced against current authority. Equal reconciliation sets still do not prove received bytes are present. Compare this with the playground’s ReconcileHeads plus containment walk experiment; neither is an adopted replacement for the other.',
    page: 'peer-rpc',
    block: 'sybc7b00',
  },
  FetchBlobs: {
    title: 'FetchBlobs',
    summary: 'The earlier proposal streams requested admitted blobs.',
    detail:
      'Requests are bound to a scope or recipient-bound export token, and authority is rechecked as responses are served. Hash full bytes before accepting a blob. The playground’s FetchBlock shows one block at a time to make these stages visible.',
    page: 'peer-rpc',
    block: 'sy892ba6',
  },
  OfferBlobs: {
    title: 'OfferBlobs',
    summary: 'Offer a publication for a receiving host to admit and fetch.',
    detail:
      'The earlier design binds a stable request ID and body digest, validates recipient custody, and lets the receiver pull wanted content through an export token. It distinguishes stored, waiting, indexed and rejected outcomes. Offers are documented but not simulated by this playground.',
    page: 'peer-rpc',
    block: 'sy5bf39e',
  },
  GetOfferStatus: {
    title: 'GetOfferStatus',
    summary: 'Recover the committed outcome of a prior publication request.',
    detail:
      'After a lost reply or reconnect, look up the same request identity instead of creating a second publication. Durable status and receipts commit with index facts. This recovery flow is not currently simulated.',
    page: 'peer-rpc',
    block: 'syad1060',
  },
  WatchScope: {
    title: 'WatchScope',
    summary: 'Resume filtered change notifications from an opaque cursor.',
    detail:
      'The earlier proposal captures a cursor at the same committed boundary as the scope. Notifications are at-least-once hints, not global authority ordering. Persist a cursor after scheduling work durably; RESET_REQUIRED means refresh control and reconcile. Watches are not currently simulated.',
    page: 'peer-rpc',
    block: 'sy82d757',
  },
}

/** Resolve a concept to its published Seed block anchor. */
export function conceptURL(key) {
  const c = syncConcepts[key]
  return `https://hyper.media/hm/z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/hm26/${c.page}#${c.block}`
}

/** Link to a precise, published Seed explanation. */
export function conceptLink(key, label = syncConcepts[key].title) {
  const c = syncConcepts[key]
  return `<a class="sync-concept" data-hm data-concept="${esc(key)}" href="${conceptURL(
    key,
  )}" target="_blank" rel="noreferrer" title="${esc(c.summary)}">${esc(label)}</a>`
}

/** Select the explanation for requests, responses, and purely local trace events. */
export function eventConcept(event) {
  if (event.method) return event.method
  if (event.kind === 'blocked') return 'blocked'
  if (event.title === 'Closure committed') return 'Commit'
  if (event.title === 'Ready to connect') return 'guide'
  return 'walk'
}
