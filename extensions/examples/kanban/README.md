# Kanban

A kanban board whose state is a hypermedia document. The board lives at the mount path itself — install the extension at
`board` and the document `hm://<site>/board` holds the columns and cards in its metadata under the `kanban` key:

```json
{
  "columns": [{"id": "c1", "title": "Todo", "cardIds": ["k1"]}],
  "cards": {"k1": {"id": "k1", "title": "Write docs", "note": "…", "link": "hm://<site>/docs"}}
}
```

Because the board is a signed document, every save is a document change confirmed by the viewer in the host, and the
history of the board is the version history of that document.

Features:

- add, rename and delete columns; add, edit and delete cards; drag cards between columns (HTML5 drag & drop, no
  library);
- cards can link to a site document, picked from a list (`Query`) or pasted as an `hm://` URL, with an **Open** button
  that navigates the host;
- **Save** (manual by default, with an unsaved-changes indicator) and an opt-in **auto-save** toggle remembered with
  `seed.storage`;
- **Reload** re-reads the board from the network;
- signed-out viewers can browse the board but not save.

Permissions: `sign`, `navigate`, `storage`.
