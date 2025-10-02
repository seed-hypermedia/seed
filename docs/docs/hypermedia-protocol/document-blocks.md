# Document Blocks

The document content is a hierarchy of blocks. These are the supported block types and formatting attributes

## Block Structure

Every block must conform to the following attributes. Some fields are optional depending on the `type`

- `id` - Unique ID for this block in the document
- `revision` - Revision identifier for this block. Must change whenever the block changes
- `text` - The text string that will be presented (only used for text blocks)
- `ref` - Pointer to the `hm://` Hypermedia URL, `ipfs://` url, or `https://` url, depending on the block types
- `annotations` - Map of [Text Annotations](#text-annotations) that will be used to enhance [text blocks](#text-blocks)
- `attributes` - Map of additional attributes based on the block type. Every value is a string

## Block Types

Each block must define the `type` field to designate one of the following supported block types:

### Paragraph Block

`type = "paragraph"`

The base [Text Block](#text-blocks) which describes a paragraph in the document.

### Heading Block

`type = "heading"`

A Text Block which is used to organize other content. As you might expect, it will be rendered with large text.

Children blocks under a heading are not indented, because the large heading text provides enough visual organization for the reader.

### Code Block

`type = "code"`

Embed some code that will be visible inside a document. The `text` field is used to contain the code that will be displayed.

Note: The code block is not considered a [Text Block](#text-blocks), because the [Text Annotations](#text-annotations) are not available for formatting text.

The following attributes are available for a code block:

- `language` - The language that will be used for syntax highlighting. Should match one of the language values from the [`highlight.js` supported language list](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md)

### Math Block

`type = "math"`

Embed a KaTeX string into a document that will be formatted into an equation.

The `text` field contains the KaTeX value.

### Image Block

`type = "image"`

Used to embed an image into a document. The block's `ref` field should point to an `ipfs://` URL.

Allows text with annotations, which will be used as the image caption.

### Video Block

`type = "video"`

Embed a video file into a document. The block's `ref` field should point to an `ipfs://` URL.

Should be a `.mp4` or `.mov` file type for maximum compatibility.

### File Block

`type = "file"`

Used to embed a file that can be downloaded from a document. The file should be uploaded to the IPFS node and the `ref` will point to the `ipfs://` url.

The following attributes may be used for file blocks:

- `name` - Specify the file name that will be displayed and used when the user downloads the file.

### Embed Block

`type = "embed"`

Embed content from one Hypermedia Document into another. The `ref` must be a `hm://` [Hypermedia URL](./hypermedia-url).

The following attributes may be used for `embed` blocks:

- `view` - card or embed

### Web Embed Block

`type = "web-embed"`

Used to embed web content into a document.

`ref` is set to a `http`/`https` URL of the content that should be embedded.

> Note: Seed Hypermedia does not support fully web embed blocks yet. We have had experimental support for Twitter URLs for embedding tweets into documents.

## Block Children Types

The children type is an attribute that is available on every block, which is used to describe how children blocks are organized. By default, children types are logically organized under a block. This will result in a visible indentation usually, except for heading blocks where the indentation is not necessesary.

The `childrenType` attribute may be set to the following:

- `group` - Default children behavior (indentation, except under headings)
- `ol` - Ordered List (Numbered Items)
- `ul` - Unordered List (Bullets)

In the case of an `ol` (Numbered List), you may also set a ??? value to specify the starting number.

## Block Classes

Blocks may be categorized into text blocks, file blocks, or other blocks.

### Text Blocks

One of:

- [`Heading`](#heading-block)
- [`Paragraph`](#paragraph-block)
- [`Image`](#image-block)

Text blocks should have a value for the `text` field, and `annotations` are used to further describe the text content.

### File Blocks

One of:

- [`Image`](#image-block)
- [`Video`](#video-block)
- [`File`](#file-block)

File blocks must have a `ref` that points to an `ipfs://` url

## Text Annotations

These are the annotations that can be used for [text blocks](#text-blocks).

### Bold Annotation

`type: "bold"`

### Italic Annotation

`type: "italic"`

### Underline Annotation

`type: "underline"`

### Strikethrough Annotation

`type: "strike"`

### Code Annotation

`type: "code"`

### Link Annotation

`type: "link"`

`ref` is set

### Inline Embed Annotation

`type: "embed"`

`\uFFFC`
