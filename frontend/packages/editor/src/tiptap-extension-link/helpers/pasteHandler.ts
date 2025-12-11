import {getDocumentTitle} from '@shm/shared/content'
import {GRPCClient} from '@shm/shared/grpc-client'
import {
  HMDocument,
  HMDocumentMetadataSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {
  hmId,
  isHypermediaScheme,
  isPublicGatewayLink,
  packHmId,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {StateStream} from '@shm/shared/utils/stream'
import {Editor} from '@tiptap/core'
import {Fragment, Mark, MarkType, Slice} from '@tiptap/pm/model'
import {Plugin, PluginKey} from '@tiptap/pm/state'
import {Decoration, DecorationSet} from '@tiptap/pm/view'
import {find} from 'linkifyjs'
import {nanoid} from 'nanoid'
import {getLinkMenuItems} from '../../blocknote/core/extensions/LinkMenu/defaultLinkMenuItems'
import {linkMenuPluginKey} from '../../blocknote/core/extensions/LinkMenu/LinkMenuPlugin'

type PasteHandlerOptions = {
  grpcClient?: GRPCClient
  editor: Editor
  type: MarkType
  linkOnPaste?: boolean
  gwUrl: StateStream<string>
  checkWebUrl: (url: string) => Promise<any>
}

export function pasteHandler(options: PasteHandlerOptions): Plugin {
  let pastePlugin = new Plugin({
    key: new PluginKey('handlePasteLink'),
    state: {
      init() {
        return DecorationSet.empty
      },
      apply(tr, set) {
        // Adjust decoration positions to changes made by the transaction
        set = set.map(tr.mapping, tr.doc)
        // See if the transaction adds or removes any placeholders
        let action = tr.getMeta('link-placeholder')
        if (action && action.add) {
          let widget = document.createElement('span')
          widget.contentEditable = 'false'
          widget.classList.add('link-placeholder')
          let deco = Decoration.widget(action.add.pos, widget, {
            link: action.add.link,
          })
          set = set.add(tr.doc, [deco])
        } else if (action && action.remove) {
          set = set.remove(
            set.find(
              // @ts-expect-error
              null,
              null,
              (spec) => spec.link.href == action.remove.link.href,
            ),
          )
        }
        return set
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
      transformPasted: (slice, view) => {
        // Add link marks to the pasted slice and return it to paste handlers
        const schema = view.state.schema
        const linkMarkType = options.type

        function addLinkMarksToFragment(fragment: Fragment): Fragment {
          const nodes: any[] = []

          fragment.forEach((node: any) => {
            if (node.type.name === 'text') {
              const text = node.text || ''
              const links = find(text) || []

              if (links.length === 0) {
                nodes.push(node)
                return
              }

              // Build the content array with link marks
              let lastIndex = 0

              links.forEach((link: any) => {
                // Add text before the link to the content array
                if (link.start > lastIndex) {
                  const beforeText = text.slice(lastIndex, link.start)
                  if (beforeText) {
                    nodes.push(schema.text(beforeText, node.marks))
                  }
                }

                // Add the link to the content array
                const linkText = text.slice(link.start, link.end)
                if (linkText) {
                  const linkMark = linkMarkType.create({
                    href: link.href,
                  })
                  nodes.push(schema.text(linkText, [...node.marks, linkMark]))
                }

                lastIndex = link.end
              })

              // Add text after the link to the content array
              if (lastIndex < text.length) {
                const afterText = text.slice(lastIndex)
                if (afterText) {
                  nodes.push(schema.text(afterText, node.marks))
                }
              }
            } else if (node.content && node.content.size > 0) {
              // Process child content
              const transformedContent = addLinkMarksToFragment(node.content)
              nodes.push(node.copy(transformedContent))
            } else {
              nodes.push(node)
            }
          })

          return Fragment.from(nodes)
        }

        // Return the transformed slice
        const transformedSlice = addLinkMarksToFragment(slice.content)
        return new Slice(transformedSlice, slice.openStart, slice.openEnd)
      },
      handlePaste: (view, _event, slice) => {
        const {state} = view
        const {selection} = state

        // Do not proceed if in code block.
        if (state.doc.resolve(selection.from).parent.type.spec.code) {
          return false
        }

        const pastedLinkMarks: Mark[] = []
        let textContent = ''

        slice.content.forEach((node) => {
          textContent += node.textContent

          node.marks.forEach((mark) => {
            if (mark.type.name === options.type.name) {
              pastedLinkMarks.push(mark)
            }
          })
        })

        textContent = textContent.trim()

        if (!textContent) {
          return false
        }

        const hasPastedLink = pastedLinkMarks.length > 0
        // const link = find(textContent).find(
        //   (item) => item.isLink && item.value === textContent,
        // )
        const matches = find(textContent)

        const link =
          matches.length === 1 &&
          // @ts-ignore
          matches[0].isLink &&
          // @ts-ignore
          textContent.trim().startsWith(matches[0].href)
            ? matches[0]
            : null
        const unpackedHmId =
          isHypermediaScheme(textContent) ||
          isPublicGatewayLink(textContent, options.gwUrl)
            ? unpackHmId(textContent)
            : null

        if (!selection.empty && options.linkOnPaste) {
          const pastedLink = unpackedHmId
            ? packHmId(unpackedHmId)
            : hasPastedLink
            ? // @ts-ignore
              pastedLinkMarks[0].attrs.href
            : link?.href || null
          if (pastedLink) {
            if (unpackedHmId) {
              options.editor
                .chain()
                .setMark(options.type, {
                  href: pastedLink,
                })
                .run()
            } else {
              let id = nanoid(8)
              options.editor
                .chain()
                .command(({tr}) => {
                  tr.setMeta('hmPlugin:uncheckedLink', id)
                  return true
                })
                .setMark(options.type, {
                  href: pastedLink,
                  id,
                })
                .run()
            }
            return true
          }
        }

        const firstChildIsText = slice.content.firstChild?.type.name === 'text'
        const firstChildContainsLinkMark = slice.content.firstChild?.marks.some(
          (mark) => mark.type.name === options.type.name,
        )

        if (firstChildIsText && firstChildContainsLinkMark) {
          return false
        }

        if (selection.empty && unpackedHmId?.uid) {
          let tr = view.state.tr

          let pos = tr.selection.from
          const normalizedHmUrl = packHmId(hmId(unpackedHmId.uid, unpackedHmId))
          if (options.grpcClient) {
            fetchEntityTitle(
              unpackedHmId,
              options.grpcClient,
              unpackedHmId.blockRef,
            )
              .then(({title}) => {
                if (title) {
                  view.dispatch(
                    tr.insertText(title, pos).addMark(
                      pos,
                      pos + title.length,
                      options.editor.schema.mark('link', {
                        href: normalizedHmUrl,
                      }),
                    ),
                  )

                  view.dispatch(
                    view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
                      activate: true,
                      ref: normalizedHmUrl,
                      items: getLinkMenuItems({
                        isLoading: false,
                        hmId: unpackHmId(normalizedHmUrl),
                        sourceUrl: normalizedHmUrl,
                        title,
                        gwUrl: options.gwUrl,
                      }),
                    }),
                  )
                } else {
                  view.dispatch(
                    tr.insertText(normalizedHmUrl, pos).addMark(
                      pos,
                      pos + normalizedHmUrl.length,
                      options.editor.schema.mark('link', {
                        href: normalizedHmUrl,
                      }),
                    ),
                  )

                  view.dispatch(
                    view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
                      activate: true,
                      ref: normalizedHmUrl,
                      items: getLinkMenuItems({
                        isLoading: false,
                        sourceUrl: normalizedHmUrl,
                        hmId: unpackHmId(normalizedHmUrl),
                        gwUrl: options.gwUrl,
                      }),
                    }),
                  )
                }
              })
              .catch((err) => {
                view.dispatch(
                  tr.insertText(normalizedHmUrl, pos).addMark(
                    pos,
                    pos + normalizedHmUrl.length,
                    options.editor.schema.mark('link', {
                      href: normalizedHmUrl,
                    }),
                  ),
                )

                view.dispatch(
                  view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
                    activate: true,
                    ref: normalizedHmUrl,
                    items: getLinkMenuItems({
                      isLoading: false,
                      sourceUrl: normalizedHmUrl,
                      hmId: unpackHmId(normalizedHmUrl),
                      gwUrl: options.gwUrl,
                    }),
                  }),
                )
              })

            return true
          }
        }

        // Check if the link is hm link
        if (selection.empty && link && !unpackedHmId) {
          let tr = view.state.tr
          if (!tr.selection.empty) tr.deleteSelection()

          const pos = view.state.selection.$from.pos

          view.dispatch(
            tr.insertText(link.href, pos).addMark(
              pos,
              pos + link.href.length,
              options.editor.schema.mark('link', {
                href: link.href,
              }),
            ),
          )

          view.dispatch(
            view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
              activate: true,
              link: link.href,
              items: getLinkMenuItems({
                isLoading: true,
                gwUrl: options.gwUrl,
              }),
            }),
          )

          resolveHypermediaUrl(link.href)
            .then(async (linkMetaResult) => {
              if (linkMetaResult?.hmId) {
                const fullHmUrl = packHmId(linkMetaResult.hmId)
                const currentPos =
                  view.state.selection.$from.pos - link.href.length
                const title = linkMetaResult.title
                const displayText = title || fullHmUrl

                view.dispatch(
                  view.state.tr
                    .deleteRange(currentPos, currentPos + link.href.length)
                    .insertText(displayText, currentPos)
                    .addMark(
                      currentPos,
                      currentPos + displayText.length,
                      options.editor.schema.mark('link', {
                        href: fullHmUrl,
                      }),
                    ),
                )

                view.dispatch(
                  view.state.tr.setMeta(linkMenuPluginKey, {
                    activate: true,
                    ref: fullHmUrl,
                    items: getLinkMenuItems({
                      isLoading: false,
                      hmId: linkMetaResult.hmId,
                      sourceUrl: fullHmUrl,
                      title,
                      type:
                        linkMetaResult.type === 'Comment'
                          ? 'Comment'
                          : 'Document',
                      gwUrl: options.gwUrl,
                    }),
                  }),
                )
              } else {
                handleWebUrl(view, link, options)
              }
            })
            .catch((err) => {
              console.log('Error checking for hypermedia site:', err)
              handleWebUrl(view, link, options)
            })

          return true
        }

        if (link && selection.empty) {
          let tr = view.state.tr
          if (!tr.selection.empty) tr.deleteSelection()

          const [mediaCase, fileName] = checkMediaUrl(link.href)

          const pos = selection.$from.pos

          view.dispatch(
            tr.insertText(link.href, pos).addMark(
              pos,
              pos + link.href.length,
              options.editor.schema.mark('link', {
                href: link.href,
              }),
            ),
          )

          view.dispatch(
            view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
              activate: true,
              link: link.href,
              items: getLinkMenuItems({
                isLoading: true,
                gwUrl: options.gwUrl,
              }),
            }),
          )

          switch (mediaCase) {
            case 'image':
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  link: link.href,
                  items: getLinkMenuItems({
                    isLoading: false,
                    media: 'image',
                    fileName: fileName,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
              break
            case 'file':
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  link: link.href,
                  items: getLinkMenuItems({
                    isLoading: false,
                    media: 'file',
                    fileName: fileName,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
              break
            case 'video':
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  link: link.href,
                  items: getLinkMenuItems({
                    isLoading: false,
                    media: 'video',
                    sourceUrl: link.href,
                    fileName: fileName,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
              break
            case 'twitter':
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  link: link.href,
                  items: getLinkMenuItems({
                    isLoading: false,
                    media: 'twitter',
                    sourceUrl: link.href,
                    fileName: fileName,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
              break
            case 'instagram':
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  link: link.href,
                  items: getLinkMenuItems({
                    isLoading: false,
                    media: 'instagram',
                    sourceUrl: link.href,
                    fileName: fileName,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
              break
            case 'web':
              {
                const metaPromise = resolveHypermediaUrl(link.href)
                  .then((linkMetaResult) => {
                    if (!linkMetaResult?.hmId) return false
                    const fullHmUrl = packHmId(linkMetaResult.hmId)
                    const currentPos =
                      view.state.selection.$from.pos - link.href.length

                    if (linkMetaResult.title) {
                      view.dispatch(
                        view.state.tr
                          .deleteRange(
                            currentPos,
                            currentPos + link.href.length,
                          )
                          .insertText(linkMetaResult.title, currentPos)
                          .addMark(
                            currentPos,
                            currentPos + linkMetaResult.title.length,
                            options.editor.schema.mark('link', {
                              href: fullHmUrl,
                            }),
                          ),
                      )
                    }

                    view.dispatch(
                      view.state.tr.setMeta(linkMenuPluginKey, {
                        link: fullHmUrl,
                        items: getLinkMenuItems({
                          hmId: linkMetaResult.hmId,
                          isLoading: false,
                          sourceUrl: fullHmUrl,
                          title: linkMetaResult.title,
                          gwUrl: options.gwUrl,
                        }),
                      }),
                    )
                    return true
                  })
                  .catch((err) => {
                    console.log('ERROR FETCHING web link')
                    console.log(err)
                  })
                const mediaPromise = Promise.resolve(false)
                // const mediaPromise = options
                //   .checkWebUrl(link.href)
                //   .then((response) => {
                //     if (response && response.contentType) {
                //       let type = response.contentType.split("/")[0];
                //       if (type === "application") type = "file";
                //       if (["image", "video", "file"].includes(type)) {
                //         view.dispatch(
                //           view.state.tr.setMeta(linkMenuPluginKey, {
                //             link: link.href,
                //             items: getLinkMenuItems({
                //               isLoading: false,
                //               media: type,
                //               sourceUrl: link.href,
                //               gwUrl: options.gwUrl,
                //             }),
                //           })
                //         );
                //         return true;
                //       }
                //     }
                //   })
                //   .catch((err) => {
                //     console.log(err);
                //   });
                Promise.all([metaPromise, mediaPromise])
                  .then((results) => {
                    const [embedResult, mediaResult] = results
                    if (!embedResult && !mediaResult) {
                      view.dispatch(
                        view.state.tr.setMeta(linkMenuPluginKey, {
                          items: getLinkMenuItems({
                            isLoading: false,
                            sourceUrl: link.href,
                            gwUrl: options.gwUrl,
                          }),
                        }),
                      )
                    }
                  })
                  .catch((err) => {
                    console.log(err)
                  })
              }
              break
            default:
              break
          }
          return true
        }

        return false
      },
    },
  })

  function checkMediaUrl(
    url: string,
  ): ['file' | 'image' | 'video' | 'web' | 'twitter' | 'instagram', string] {
    const matchResult = url.match(/[^/\\&\?]+\.\w{3,4}(?=([\?&].*$|$))/)
    if (matchResult) {
      const extensionArray = matchResult[0].split('.')
      const extension = extensionArray[extensionArray.length - 1]
      // @ts-expect-error
      if (['png', 'jpg', 'jpeg'].includes(extension)) return [1, matchResult[0]]
      // @ts-ignore
      else if (['pdf', 'xml', 'csv'].includes(extension))
        return ['file', matchResult[0]]
      // @ts-ignore
      else if (['mp4', 'webm', 'ogg'].includes(extension))
        return ['video', matchResult[0]]
    } else if (
      ['youtu.be', 'youtube', 'vimeo'].some((value) => url.includes(value))
    ) {
      return ['video', '']
    } else if (['twitter', 'x.com'].some((value) => url.includes(value))) {
      return ['twitter', '']
    } else if (['instagram'].some((value) => url.includes(value))) {
      return ['instagram', '']
    }
    return ['web', '']
  }

  function handleWebUrl(view: any, link: any, options: PasteHandlerOptions) {
    const [mediaCase, fileName] = checkMediaUrl(link.href)

    view.dispatch(
      view.state.tr.scrollIntoView().setMeta(linkMenuPluginKey, {
        activate: true,
        link: link.href,
        items: getLinkMenuItems({
          isLoading: true,
          gwUrl: options.gwUrl,
        }),
      }),
    )

    switch (mediaCase) {
      case 'image':
        view.dispatch(
          view.state.tr.setMeta(linkMenuPluginKey, {
            link: link.href,
            items: getLinkMenuItems({
              isLoading: false,
              media: 'image',
              fileName: fileName,
              gwUrl: options.gwUrl,
            }),
          }),
        )
        break
      case 'file':
        view.dispatch(
          view.state.tr.setMeta(linkMenuPluginKey, {
            link: link.href,
            items: getLinkMenuItems({
              isLoading: false,
              media: 'file',
              fileName: fileName,
              gwUrl: options.gwUrl,
            }),
          }),
        )
        break
      case 'video':
        view.dispatch(
          view.state.tr.setMeta(linkMenuPluginKey, {
            link: link.href,
            items: getLinkMenuItems({
              isLoading: false,
              media: 'video',
              sourceUrl: link.href,
              fileName: fileName,
              gwUrl: options.gwUrl,
            }),
          }),
        )
        break
      case 'twitter':
        view.dispatch(
          view.state.tr.setMeta(linkMenuPluginKey, {
            link: link.href,
            items: getLinkMenuItems({
              isLoading: false,
              media: 'twitter',
              sourceUrl: link.href,
              fileName: fileName,
              gwUrl: options.gwUrl,
            }),
          }),
        )
        break
      case 'instagram':
        view.dispatch(
          view.state.tr.setMeta(linkMenuPluginKey, {
            link: link.href,
            items: getLinkMenuItems({
              isLoading: false,
              media: 'instagram',
              sourceUrl: link.href,
              fileName: fileName,
              gwUrl: options.gwUrl,
            }),
          }),
        )
        break
      case 'web': {
        const metaPromise = resolveHypermediaUrl(link.href)
          .then((linkMetaResult) => {
            if (!linkMetaResult?.hmId) return false
            const fullHmUrl = packHmId(linkMetaResult.hmId)
            const currentPos = view.state.selection.$from.pos - link.href.length

            if (linkMetaResult.title) {
              view.dispatch(
                view.state.tr
                  .deleteRange(currentPos, currentPos + link.href.length)
                  .insertText(linkMetaResult.title, currentPos)
                  .addMark(
                    currentPos,
                    currentPos + linkMetaResult.title.length,
                    options.editor.schema.mark('link', {
                      href: fullHmUrl,
                    }),
                  ),
              )
            }

            view.dispatch(
              view.state.tr.setMeta(linkMenuPluginKey, {
                link: fullHmUrl,
                items: getLinkMenuItems({
                  hmId: linkMetaResult.hmId,
                  isLoading: false,
                  sourceUrl: fullHmUrl,
                  title: linkMetaResult.title,
                  gwUrl: options.gwUrl,
                }),
              }),
            )
            return true
          })
          .catch((err) => {
            console.log('ERROR FETCHING web link')
            console.log(err)
          })
        metaPromise
          .then((embedResult) => {
            if (!embedResult) {
              view.dispatch(
                view.state.tr.setMeta(linkMenuPluginKey, {
                  items: getLinkMenuItems({
                    isLoading: false,
                    sourceUrl: link.href,
                    gwUrl: options.gwUrl,
                  }),
                }),
              )
            }
          })
          .catch((err) => {
            console.log(err)
          })
        break
      }
      default:
        break
    }
  }

  return pastePlugin
}

// List normalization function
function getPastedNodes(parent: any, editor: any): any[] {
  const nodes: any[] = []

  parent.forEach((node: any) => {
    if (node.type.name === 'blockGroup') {
      const prevContainer = nodes.pop()
      if (prevContainer) {
        // @ts-ignore
        const container = editor.schema.nodes['blockContainer'].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node),
        )
        nodes.push(container)
      }
    } else if (node.type.name !== 'blockContainer') {
      let nodeToInsert = node
      if (node.type.name === 'text') {
        // @ts-ignore
        nodeToInsert = editor.schema.nodes.paragraph.create({}, node)
      }
      // @ts-ignore
      const container = editor.schema.nodes['blockContainer'].create(
        null,
        nodeToInsert,
      )
      nodes.push(container)
    } else if (node.firstChild?.type.name === 'blockGroup') {
      const prevContainer = nodes.pop()
      if (prevContainer) {
        // @ts-ignore
        const container = editor.schema.nodes['blockContainer'].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node.firstChild!),
        )
        nodes.push(container)
      } else {
        nodes.push(node.firstChild!)
      }
    } else {
      nodes.push(node)
    }
  })

  return nodes
}

async function fetchEntityTitle(
  hmId: UnpackedHypermediaId,
  grpcClient: GRPCClient,
  blockRef?: string | null,
) {
  const document = await grpcClient.documents.getDocument({
    account: hmId.uid,
    path: hmIdPathToEntityQueryPath(hmId.path),
  })
  const doc = document
  let title
  if (blockRef) {
    // @ts-ignore
    const block = doc.content.find((block) => {
      if (block.block) {
        return block.block.id === blockRef
      }
    })
    if (block?.block?.type === 'Heading') {
      title = block.block.text
    }
  }
  if (!title) {
    title = getDocumentTitle({
      ...doc,
      metadata: HMDocumentMetadataSchema.parse(
        doc.metadata?.toJson({emitDefaultValues: true}),
      ),
    } as HMDocument)
  }
  return {
    title,
  }
  // } else if (hmId.type == 'c') {
  //   try {
  //     const comment = await grpcClient.comments.getComment({
  //       id: hmId.uid,
  //     })
  //     if (comment) {
  //       const authorHomeDocRaw = await grpcClient.documents.getDocument({
  //         account: comment.author,
  //       })
  //       const authorHomeDoc = prepareHMDocument(authorHomeDocRaw)
  //       return {
  //         title: `Comment from ${
  //           authorHomeDoc.metadata?.name ||
  //           `${comment.author.slice(0, 5)}...${comment.author.slice(-5)}`
  //         }`,
  //       }
  //     } else {
  //       return {
  //         title: null,
  //       }
  //     }
  //   } catch (error) {
  //     console.error(`fetchEntityTitle error: ${JSON.stringify(error)}`)
  //     return {title: null}
  //   }

  // @ts-ignore
  return {title: null}
}
