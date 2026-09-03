---
name: Repo HM sync
summary: How a directory of markdown files in a git repository and a Hypermedia space mirror each other without losing anything, and how to edit either side.
---
A Hypermedia document is a tree of typed blocks with annotations and metadata. Markdown has syntax for most of that and none for the rest. Repo HM sync keeps a directory of markdown files in a git repository and a Hypermedia space in step by using a markdown dialect that carries everything a document can hold, so a document exported to a file and imported again is the same document, and a file exported from a document and re-exported is the same text.

# The dialect

Where markdown has syntax, the dialect uses it: headings, paragraphs, lists, block quotes, fenced code, math, images, links, tables, bold, italic, strikethrough and inline code all look like ordinary markdown and render fine on GitHub.

Every block ends with an HTML comment carrying its identity, `<!-- id:X -->`. Identity is what makes an edit an update of an existing block instead of a replacement. Two optional keys ride in the same comment when markdown has no syntax for something: `type:` names a block type such as Video, File, Button, Embed or Query, and `attrs:` holds a JSON object of attributes such as an image width or a query definition. A block with nothing special looks like plain markdown plus its id.

Nesting is indentation. A block's children sit two spaces deeper, or at the content column of a list marker. A heading's children follow it at the same indentation, and `<!-- end:X -->` closes a heading when a non-heading sibling follows. Frontmatter carries every metadata key of the document, including keys the client does not know about.

Text is escaped so that markdown syntax characters survive, newlines inside a block are written as `<br>`, and style annotations that markdown lacks, such as underline, highlight and colors, are written as inline HTML tags.

# Import and export

`space export` writes every document of a space into a directory: the home document as `index.md` and a document at `/a/b` as `a/b.md`. It only touches files whose content changed. Links between documents of the space become relative file links, so they work on GitHub too.

`space import` publishes a directory into a space. For each file it fetches the current document, diffs the blocks by id, and publishes a change on the document's existing history. Unchanged documents produce no change at all, so running it repeatedly never spams versions. A hand-written file with no ids is matched to the existing document by position, so editing a paragraph in place updates that paragraph rather than replacing the page. Relative links to other files in the directory become links to the corresponding documents.

# Editing in the app

`space dev` turns the desktop dev app into the editor for a directory. It creates a throwaway key under `.dev/` in the directory, registers it in the app's own daemon, publishes the directory there, and then watches the daemon. Every document you publish in the app is written straight back as a file, so `git diff` shows the edit within seconds. Nothing reaches the network until you import into a real space.

While the loop runs, the app is the writer and git is where you commit.
