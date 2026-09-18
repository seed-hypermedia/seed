# Seed Document Block Format

Reference for generating Seed Hypermedia documents as JSON block trees. Use `-f blocks.json` with the CLI's
`document create` or `document update` commands, or pipe JSON via stdin.

## Block Node Structure

A document is an array of top-level `HMBlockNode` objects. Each node has a `block` and optional `children`:

```json
[
  {
    "block": { "id": "...", "type": "...", ... },
    "children": [ /* nested HMBlockNode[] */ ]
  }
]
```

## Block IDs

Every block requires a unique `id`: 8 random characters from `[A-Za-z0-9_-]` (64-char alphabet). Generate fresh IDs for
each block.

## Block Types

### Paragraph

```json
{
  "id": "aBcD1234",
  "type": "Paragraph",
  "text": "Hello world",
  "annotations": [],
  "attributes": {}
}
```

### Heading

Same as Paragraph but `type: "Heading"`. Content nested under a heading becomes its `children`. Set
`attributes.childrenType` to `"Group"` (default, may omit) so children render as nested content.

```json
{
  "id": "hd1_abcd",
  "type": "Heading",
  "text": "Introduction",
  "annotations": [],
  "attributes": {"childrenType": "Group"}
}
```

### Code

```json
{
  "id": "cd1_abcd",
  "type": "Code",
  "text": "console.log('hello')",
  "attributes": {"language": "javascript"}
}
```

### Math

`text` contains LaTeX source. Rendered client-side via KaTeX.

```json
{
  "id": "mt1_abcd",
  "type": "Math",
  "text": "E = mc^2",
  "attributes": {}
}
```

### Image

`link` is either `ipfs://CID` (already uploaded) or `file:///absolute/path` (CLI resolves to IPFS automatically). `text`
is optional caption.

```json
{
  "id": "im1_abcd",
  "type": "Image",
  "text": "Figure 1: Architecture diagram",
  "link": "file:///tmp/figure1.png",
  "annotations": [],
  "attributes": {"width": 800}
}
```

### Video

```json
{
  "id": "vd1_abcd",
  "type": "Video",
  "link": "file:///tmp/intro.mp4",
  "attributes": {"width": 640, "name": "intro.mp4"}
}
```

### File

```json
{
  "id": "fl1_abcd",
  "type": "File",
  "link": "file:///tmp/data.csv",
  "attributes": {"name": "data.csv", "size": 1024}
}
```

### Embed (Seed document reference)

```json
{
  "id": "em1_abcd",
  "type": "Embed",
  "link": "hm://z6Mk.../some-document",
  "attributes": {"view": "Card"}
}
```

`view`: `"Content"` (inline), `"Card"` (preview card), `"Comments"` (comment thread).

### WebEmbed

```json
{
  "id": "we1_abcd",
  "type": "WebEmbed",
  "link": "https://www.youtube.com/watch?v=..."
}
```

### Button

```json
{
  "id": "bt1_abcd",
  "type": "Button",
  "text": "Learn more",
  "link": "https://example.com",
  "attributes": {"alignment": "center"}
}
```

`alignment`: `"flex-start"` | `"center"` | `"flex-end"`.

## Children Types (Lists, Blockquotes)

The `attributes.childrenType` field on a parent block controls how its `children` render:

| Value                | Rendering                |
| -------------------- | ------------------------ |
| `"Group"` or omitted | Default nested content   |
| `"Ordered"`          | Numbered list (1. 2. 3.) |
| `"Unordered"`        | Bullet list              |
| `"Blockquote"`       | Blockquoted content      |

**Lists** are a container Paragraph (with empty text and `childrenType`) whose children are the list items:

```json
{
  "block": {
    "id": "ls1_abcd",
    "type": "Paragraph",
    "text": "",
    "annotations": [],
    "attributes": {"childrenType": "Unordered"}
  },
  "children": [
    {"block": {"id": "li1_abcd", "type": "Paragraph", "text": "First item", "annotations": []}, "children": []},
    {"block": {"id": "li2_abcd", "type": "Paragraph", "text": "Second item", "annotations": []}, "children": []}
  ]
}
```

## Annotations (Inline Formatting)

Annotations mark spans within a block's `text` using byte-offset arrays `starts` and `ends`. Multiple spans of the same
annotation type are encoded in the same annotation object.

| Type        | Fields                   | Description            |
| ----------- | ------------------------ | ---------------------- |
| `Bold`      | `starts`, `ends`         | **Bold** text          |
| `Italic`    | `starts`, `ends`         | _Italic_ text          |
| `Underline` | `starts`, `ends`         | Underlined text        |
| `Strike`    | `starts`, `ends`         | ~~Strikethrough~~ text |
| `Code`      | `starts`, `ends`         | `Inline code`          |
| `Link`      | `starts`, `ends`, `link` | Hyperlink              |
| `Embed`     | `starts`, `ends`, `link` | Inline embed reference |

**Example**: `"Hello **bold** world"` where "bold" (positions 6-10) is bold:

```json
{
  "text": "Hello bold world",
  "annotations": [{"type": "Bold", "starts": [6], "ends": [10]}]
}
```

Multiple spans: `"A **B** C **D**"` where B (2-3) and D (6-7) are bold:

```json
{
  "text": "A B C D",
  "annotations": [{"type": "Bold", "starts": [2, 6], "ends": [3, 7]}]
}
```

Link annotation:

```json
{
  "text": "Click here for details",
  "annotations": [{"type": "Link", "starts": [6], "ends": [10], "link": "https://example.com"}]
}
```

## Image Handling

### Local files (file://)

Set `"link": "file:///absolute/path/to/image.png"`. The CLI reads the file, chunks it with IPFS UnixFS, replaces the
link with `ipfs://CID`, and publishes image blocks atomically alongside the document.

### Already uploaded (ipfs://)

Set `"link": "ipfs://bafkrei..."` for images that are already stored on the target server.

## Comprehensive Example

A document with headings, nested content, formatted text, lists, code, math, an image, and an embed:

```json
[
  {
    "block": {
      "id": "hd_Intro1",
      "type": "Heading",
      "text": "Project Overview",
      "annotations": [],
      "attributes": {"childrenType": "Group"}
    },
    "children": [
      {
        "block": {
          "id": "p_desc01",
          "type": "Paragraph",
          "text": "This project implements a distributed protocol with strong consistency guarantees.",
          "annotations": [
            {"type": "Bold", "starts": [29, 60], "ends": [50, 79]},
            {"type": "Italic", "starts": [29], "ends": [50]},
            {"type": "Link", "starts": [60], "ends": [79], "link": "https://en.wikipedia.org/wiki/Consistency_model"}
          ]
        },
        "children": []
      },
      {
        "block": {
          "id": "im_arch01",
          "type": "Image",
          "text": "Figure 1: System architecture",
          "link": "file:///tmp/pdf-images/architecture.png",
          "annotations": [],
          "attributes": {"width": 800}
        },
        "children": []
      },
      {
        "block": {
          "id": "hd_Goals1",
          "type": "Heading",
          "text": "Goals",
          "annotations": [],
          "attributes": {"childrenType": "Group"}
        },
        "children": [
          {
            "block": {
              "id": "ol_cont1",
              "type": "Paragraph",
              "text": "",
              "annotations": [],
              "attributes": {"childrenType": "Ordered"}
            },
            "children": [
              {
                "block": {
                  "id": "li_goal1",
                  "type": "Paragraph",
                  "text": "Achieve sub-second latency for all read operations",
                  "annotations": [{"type": "Bold", "starts": [8], "ends": [18]}]
                },
                "children": []
              },
              {
                "block": {
                  "id": "li_goal2",
                  "type": "Paragraph",
                  "text": "Support 10,000+ concurrent writers",
                  "annotations": [{"type": "Code", "starts": [8], "ends": [14]}]
                },
                "children": []
              },
              {
                "block": {
                  "id": "li_goal3",
                  "type": "Paragraph",
                  "text": "Maintain CRDT-based conflict resolution",
                  "annotations": [
                    {"type": "Strike", "starts": [0], "ends": [8]},
                    {"type": "Underline", "starts": [15], "ends": [34]}
                  ]
                },
                "children": []
              }
            ]
          }
        ]
      },
      {
        "block": {
          "id": "hd_Tech01",
          "type": "Heading",
          "text": "Technical Details",
          "annotations": [],
          "attributes": {"childrenType": "Group"}
        },
        "children": [
          {
            "block": {
              "id": "p_tech01",
              "type": "Paragraph",
              "text": "The core algorithm uses a Merkle DAG for content-addressed storage.",
              "annotations": [
                {"type": "Code", "starts": [26], "ends": [36]},
                {"type": "Italic", "starts": [41], "ends": [60]}
              ]
            },
            "children": []
          },
          {
            "block": {
              "id": "cd_algo1",
              "type": "Code",
              "text": "func Store(data []byte) CID {\n  hash := sha256.Sum256(data)\n  cid := NewCIDv1(hash)\n  blockstore.Put(cid, data)\n  return cid\n}",
              "attributes": {"language": "go"}
            },
            "children": []
          },
          {
            "block": {
              "id": "mt_form1",
              "type": "Math",
              "text": "H(x) = \\sum_{i=0}^{n} h(x_i) \\mod 2^{256}",
              "attributes": {}
            },
            "children": []
          },
          {
            "block": {
              "id": "bq_cont1",
              "type": "Paragraph",
              "text": "",
              "annotations": [],
              "attributes": {"childrenType": "Blockquote"}
            },
            "children": [
              {
                "block": {
                  "id": "bq_text1",
                  "type": "Paragraph",
                  "text": "Content addressing is the foundation of trustless distributed systems.",
                  "annotations": [{"type": "Italic", "starts": [0], "ends": [19]}]
                },
                "children": []
              }
            ]
          },
          {
            "block": {
              "id": "ul_feat1",
              "type": "Paragraph",
              "text": "",
              "annotations": [],
              "attributes": {"childrenType": "Unordered"}
            },
            "children": [
              {
                "block": {
                  "id": "li_ft01",
                  "type": "Paragraph",
                  "text": "Content-addressed blocks with CIDv1",
                  "annotations": [{"type": "Bold", "starts": [0], "ends": [18]}]
                },
                "children": []
              },
              {
                "block": {
                  "id": "li_ft02",
                  "type": "Paragraph",
                  "text": "Bitswap protocol for P2P block exchange",
                  "annotations": [
                    {"type": "Link", "starts": [0], "ends": [16], "link": "https://docs.ipfs.tech/concepts/bitswap/"}
                  ]
                },
                "children": []
              }
            ]
          }
        ]
      },
      {
        "block": {
          "id": "hd_Refs01",
          "type": "Heading",
          "text": "References",
          "annotations": [],
          "attributes": {"childrenType": "Group"}
        },
        "children": [
          {
            "block": {
              "id": "em_ref01",
              "type": "Embed",
              "link": "hm://z6Mkon33EULrw7gnZHrcqX89W11NtEatDk6rnq2Qm7ysJwm4/protocol-spec",
              "attributes": {"view": "Card"}
            },
            "children": []
          },
          {
            "block": {
              "id": "we_ref01",
              "type": "WebEmbed",
              "link": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            },
            "children": []
          }
        ]
      }
    ]
  }
]
```
