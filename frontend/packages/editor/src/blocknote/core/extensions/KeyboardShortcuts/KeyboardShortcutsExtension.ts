import {Extension} from "@tiptap/core";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import {Node as PMNode} from "prosemirror-model";
import {NodeSelection, TextSelection} from "prosemirror-state";
import {mergeBlocksCommand} from "../../api/blockManipulation/commands/mergeBlocks";
import {
  nestBlock,
  unnestBlock,
} from "../../api/blockManipulation/commands/nestBlock";
import {splitBlockCommand} from "../../api/blockManipulation/commands/splitBlock";
import {updateBlockCommand} from "../../api/blockManipulation/commands/updateBlock";
import {updateGroupChildrenCommand} from "../../api/blockManipulation/commands/updateGroup";
import {BlockNoteEditor} from "../../BlockNoteEditor";
import {
  getBlockInfoFromPos,
  getBlockInfoFromSelection,
} from "../Blocks/helpers/getBlockInfoFromPos";
import {getGroupInfoFromPos} from "../Blocks/helpers/getGroupInfoFromPos";
import {SelectionPluginKey} from "../Blocks/nodes/BlockContainer";

export const KeyboardShortcutsExtension = Extension.create<{
  editor: BlockNoteEditor<any>;
  //   tabBehavior: 'prefer-navigate-ui' | 'prefer-indent'
}>({
  // Ensures content-specific keyboard shortcuts trigger first.
  priority: 50,

  // TODO: The shortcuts need a refactor. Do we want to use a command priority
  //  design as there is now, or clump the logic into a single function?
  addKeyboardShortcuts() {
    // handleBackspace is partially adapted from https://github.com/ueberdosis/tiptap/blob/ed56337470efb4fd277128ab7ef792b37cfae992/packages/core/src/extensions/keymap.ts
    const handleBackspace = () =>
      this.editor.commands.first(({chain, commands}) => [
        // Deletes the selection if it's not empty.
        () => commands.deleteSelection(),
        // Undoes an input rule if one was triggered in the last editor state change.
        () => commands.undoInputRule(),
        // Moves a first child block of a heading to be a part of the heading.
        () =>
          commands.command(({state, dispatch}) => {
            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const blockInfo = getBlockInfoFromSelection(state);

            const isParagraph = blockInfo.blockContentType === "paragraph";
            const $pos = state.doc.resolve(state.selection.from);
            const depth = $pos.depth;
            let parentInfo:
              | {parentBlock: PMNode; parentGroup: PMNode; parentPos: number}
              | undefined;

            if (depth > 3) {
              parentInfo = {
                parentBlock: $pos.node(depth - 3).firstChild!,
                parentGroup: $pos.node(depth - 2),
                parentPos: $pos.start(depth - 3),
              };
            }

            if (selectionAtBlockStart && isParagraph && parentInfo) {
              const {parentBlock, parentGroup, parentPos} = parentInfo;
              let isFirstChild =
                blockInfo.block.node.attrs.id ==
                parentGroup.firstChild?.attrs.id;
              let isParentBlockHeading = parentBlock?.type.name == "heading";

              if (
                // is the first child of the parent group
                isFirstChild &&
                // the parent of the current block is type "heading"
                isParentBlockHeading &&
                // parentBlock is defined
                parentBlock
              ) {
                const {block, blockContent} = blockInfo;

                // the position in which we are inserting the current block content
                const parentInsertPos = parentPos + parentBlock?.nodeSize - 1;

                // lift any children of current block (if any)
                if (block.node.childCount == 2) {
                  // the current block has children, we need to re-parent
                  const childBlocksStart = state.doc.resolve(
                    block.beforePos + blockContent.node.nodeSize + 2
                  );
                  const childBlocksEnd = state.doc.resolve(block.afterPos - 2);
                  const childBlocksRange =
                    childBlocksStart.blockRange(childBlocksEnd);

                  // Moves the block group node inside the block into
                  // the block group node that the current block is in.
                  if (dispatch) {
                    state.tr.lift(
                      childBlocksRange!,
                      state.doc.resolve(state.selection.from).depth - 2
                    );
                  }
                }

                if (dispatch) {
                  dispatch(
                    state.tr
                      // delete the current block content
                      .deleteRange(
                        block.beforePos + 1,
                        block.beforePos + blockContent.node.nodeSize + 1
                      )
                      // insert the current block content into the parent heading
                      .insert(parentInsertPos, blockContent.node.content)
                  );

                  // set the selection to the join between the previous heading content and the new content inserted
                  // this needs to happen after the transaction above because the document now is "different", hence we need to set
                  // the selection to a new pos.
                  state.tr.setSelection(
                    new TextSelection(state.doc.resolve(parentInsertPos))
                  );
                }

                return true;
              }
            }
            return false;
          }),
        // Convert a list into a normal group if the selection is at the start of the list
        // TODO: figure out if it's needed, because lifting the first list item from the group seems reasonable.
        // () =>
        //   commands.command(({state, view}) => {
        //     const {group, container, depth, $pos} = getGroupInfoFromPos(
        //       state.selection.from,
        //       state,
        //     )

        //     if (group.attrs.listType !== 'div' && $pos.pos === $pos.start()) {
        //       // If block is first in the group change group type
        //       if (
        //         container &&
        //         group.firstChild?.attrs.id === container.attrs.id
        //       ) {
        //         setTimeout(() => {
        //           view.dispatch(
        //             state.tr.setNodeMarkup($pos.before(depth), null, {
        //               ...group.attrs,
        //               listType: 'div',
        //               listLevel: '1',
        //             }),
        //           )

        //           this.editor.commands.UpdateGroupChildren(
        //             group,
        //             container,
        //             $pos,
        //             0,
        //             group.attrs.listType,
        //             -1,
        //           )
        //         })

        //         return true
        //       }
        //     }
        //     return false
        //   }),
        // If previous block is media, set Node Selection to that block.
        () =>
          commands.command(({state, dispatch, view}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const prevBlockInfo = getBlockInfoFromPos(
              state,
              state.selection.$anchor.pos - state.selection.$anchor.depth
            );
            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;

            const isParagraph = blockInfo.blockContentType === "paragraph";

            if (selectionAtBlockStart) {
              if (isParagraph) {
                // If the selection is inside the image caption, first select the image.
                if (blockInfo.blockContentType === "image") {
                  let tr = state.tr;
                  const selection = NodeSelection.create(
                    state.doc,
                    blockInfo.block.beforePos + 1
                  );
                  tr = tr.setSelection(selection);
                  view.dispatch(tr);
                  return true;
                }
                if (!prevBlockInfo) return false;
                if (
                  ["file", "embed", "video", "web-embed", "math"].includes(
                    prevBlockInfo.blockContentType
                  ) ||
                  (prevBlockInfo.blockContentType === "image" &&
                    prevBlockInfo.blockContent.node.attrs.url.length === 0)
                ) {
                  if (dispatch) {
                    state.tr.setSelection(
                      NodeSelection.create(
                        state.doc,
                        prevBlockInfo.block.beforePos + 1
                      )
                    );

                    // Uncomment to not delete the text where the current selection is in.
                    // if (!blockInfo.contentNode.textContent) {
                    state.tr.deleteRange(
                      blockInfo.block.beforePos + 1,
                      blockInfo.block.beforePos +
                        blockInfo.blockContent.node.nodeSize +
                        1
                    );
                    // }
                    return true;
                  }
                }
                return false;
              }
              // Instead of selecting the media block, first change
              // the type of selected block to paragraph.
              else {
                return commands.command(
                  updateBlockCommand(
                    state.doc.resolve(state.selection.from).start() - 2,
                    {
                      type: "paragraph",
                      props: {},
                    }
                  )
                );
              }
            }

            return false;
          }),
        // move blockID with content if selection is at the start of block,
        // the block has content AND the block above is empty.
        () =>
          commands.command(({state, chain}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const groupData = getGroupInfoFromPos(state.selection.from!, state);
            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;

            let prevBlockEndPos = blockInfo.block.beforePos - 1;
            let prevBlockInfo = getBlockInfoFromPos(state, prevBlockEndPos);

            if (
              // selection is at the start of the block
              selectionAtBlockStart &&
              // current block is not empty
              blockInfo.block.node.textContent.length > 0 &&
              // the selected block is not the first block of the child
              groupData.group.firstChild?.attrs.id !=
                blockInfo.block.node.attrs.id &&
              // previous block is a blockContainer
              prevBlockInfo.block.node.type.name == "blockContainer" &&
              // prev block is empty
              prevBlockInfo.block.node.textContent.length == 0
            ) {
              chain()
                .BNDeleteBlock(prevBlockInfo.block.beforePos + 1)
                .run();

              return true;
            }
            return false;
          }),
        // Merge block with the previous block, if it is in the middle of a list.
        () =>
          commands.command(({state, commands}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const groupData = getGroupInfoFromPos(state.selection.from!, state);
            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;

            let prevBlockEndPos = blockInfo.block.beforePos;
            let prevBlockInfo = getBlockInfoFromPos(state, prevBlockEndPos);

            if (
              // Uncomment 2 lines below to first unnest the block if it's not in the list
              // // group is not a list or blockquote
              // groupData.group.attrs.listType !== 'Group' &&
              // selection is at the start of the block
              selectionAtBlockStart &&
              // the selected block is not the first block of the group
              groupData.group.firstChild?.attrs.id !=
                blockInfo.block.node.attrs.id &&
              // previous block is a blockContainer
              prevBlockInfo.block.node.type.name == "blockContainer"
            ) {
              return commands.command(
                mergeBlocksCommand(blockInfo.block.beforePos)
              );
            }
            return false;
          }),
        // Reverts block content type to a paragraph if the selection is at the start of the block.
        () =>
          commands.command(({state}) => {
            const blockInfo = getBlockInfoFromSelection(state);

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const isParagraph = blockInfo.blockContentType === "paragraph";

            if (selectionAtBlockStart && !isParagraph) {
              return commands.command(
                updateBlockCommand(blockInfo.block.beforePos + 1, {
                  type: "paragraph",
                  props: {},
                })
              );
            }

            return false;
          }),
        // Removes a level of nesting if the block is indented if the selection is at the start of the block.
        () =>
          commands.command(({state}) => {
            const {blockContent} = getBlockInfoFromSelection(state);
            const selectionAtBlockStart =
              state.selection.from === blockContent.beforePos + 1;

            if (selectionAtBlockStart && state.selection.$from.depth - 1 > 2) {
              setTimeout(() => {
                unnestBlock(this.editor, state.selection.from);
              });

              return true;
            }
            return false;
          }),
        // Merges block with the previous one if it isn't indented,
        // and the selection is at the start of the block.
        // The target block for merging must contain inline content.
        () =>
          commands.command(({state}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const {block: blockContainer, blockContent} = blockInfo;

            const selectionAtBlockStart =
              state.selection.from === blockContent.beforePos + 1;
            const selectionEmpty = state.selection.empty;

            const posBetweenBlocks = blockContainer.beforePos;

            if (selectionAtBlockStart && selectionEmpty) {
              return chain()
                .command(mergeBlocksCommand(posBetweenBlocks))
                .scrollIntoView()
                .run();
            }

            return false;
          }),
      ]);

    const handleDelete = () =>
      this.editor.commands.first(({commands}) => [
        // Deletes the selection if it's not empty.
        () => commands.deleteSelection(),
        // Merges block with the next one (at the same nesting level or lower),
        // if one exists, the block has no children, and the selection is at the
        // end of the block.
        () =>
          commands.command(({state, dispatch}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const {
              block: blockContainer,
              blockContent,
              childContainer,
            } = blockInfo;

            const {depth} = state.doc.resolve(blockContainer.beforePos);
            const blockAtDocEnd =
              blockContainer.afterPos === state.doc.nodeSize - 3;
            const selectionAtBlockEnd =
              state.selection.from === blockContent.afterPos - 1;
            const selectionEmpty = state.selection.empty;
            const hasChildBlocks = childContainer !== undefined;
            if (!blockAtDocEnd && selectionAtBlockEnd && selectionEmpty) {
              // If the block has children, merge with the first child and lift other children
              if (hasChildBlocks) {
                // Get boundaries of the child block group
                const childBlocksStart = state.doc.resolve(
                  blockInfo.childContainer!.beforePos + 1
                );
                const childBlocksEnd = state.doc.resolve(
                  blockInfo.childContainer!.afterPos - 1
                );
                const childBlocksRange =
                  childBlocksStart.blockRange(childBlocksEnd);

                if (dispatch) {
                  const pos = state.doc.resolve(blockInfo.block.beforePos);
                  let tr = state.tr;

                  // Lift all children of the block
                  tr.lift(childBlocksRange!, pos.depth);

                  // Check if the first child is a mention or has marks
                  if (
                    childContainer.node.firstChild!.firstChild!.content
                      .firstChild?.type.name === "inline-embed" ||
                    childContainer.node.firstChild!.firstChild!.content
                      .firstChild?.marks.length
                  ) {
                    // Get resolved position of the block content.
                    const $contentPos = state.doc.resolve(
                      blockInfo.block.beforePos + 2
                    );

                    // Get resolved positions of the current block and first child after the lift.
                    const afterStepPos = tr.doc.resolve(
                      blockInfo.block.beforePos + 3
                    );
                    const afterStepNextPos = tr.doc.resolve(
                      afterStepPos.end() + 3
                    );

                    // Replace the block's content with new merged content.
                    tr.replaceRangeWith(
                      $contentPos.start() - 1,
                      $contentPos.end() + 1,
                      state.schema.nodes["paragraph"].create(
                        blockInfo.blockContent.node.attrs,
                        [
                          ...blockInfo.blockContent.node.content.content,
                          ...childContainer.node.firstChild!.firstChild!.content
                            .content,
                        ]
                      )
                    );

                    // Delete the first child of the block.
                    tr.delete(
                      afterStepNextPos.start() - 1,
                      afterStepNextPos.end() + 1
                    );

                    // Set cursor in between of the end of block's and first child's text contents.
                    tr.setSelection(
                      new TextSelection(tr.doc.resolve(afterStepPos.end()))
                    );

                    return true;
                  }

                  // Insert the first character of the first child at the end of the block
                  // Note: This is a hacky fix, because when merging with first child, for
                  // some reason it doesn't work with precise positions, so it needs to go into
                  // the next block for 1 position, which removes the first character of the first child.
                  // tr.insertText(
                  //   blockInfo.childContainer!.node.firstChild!.textContent[0],
                  //   tr.doc.resolve(blockInfo.block.beforePos + 2).end(),
                  // )

                  // Get position of the current block and first child after the lift.
                  const afterStepPos = tr.doc.resolve(
                    blockInfo.block.beforePos + 3
                  );
                  const afterStepNextPos = tr.doc.resolve(
                    afterStepPos.end() + 3
                  );

                  // Delete the boundary between the block and first child.
                  tr.delete(afterStepPos.end(), afterStepNextPos.start() + 1);

                  return true;
                }
                return false;
              } else {
                // Merge with next block
                let oldDepth = depth;
                let newPos = blockContainer.afterPos + 1;
                let newDepth = state.doc.resolve(newPos).depth;

                while (newDepth < oldDepth) {
                  oldDepth = newDepth;
                  newPos += 2;
                  newDepth = state.doc.resolve(newPos).depth;
                }

                return commands.command(mergeBlocksCommand(newPos - 1));
              }
            }

            return false;
          }),
      ]);

    const handleEnter = () =>
      this.editor.commands.first(({commands}) => [
        // Add a block on top of the current one, if the block is not
        // empty and the selection is at the start of that block,
        // to make sure the block ID will follow the content.
        // Note: Horacio added this code.
        () =>
          commands.command(({state, chain}) => {
            const blockInfo = getBlockInfoFromSelection(state);

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockInfo.block.node.textContent.length === 0;
            const newBlockInsertionPos = blockInfo.block.beforePos;

            if (selectionAtBlockStart && selectionEmpty && !blockEmpty) {
              chain()
                .BNCreateBlock(newBlockInsertionPos)
                // .setTextSelection(newBlockContentPos)
                .run();

              return true;
            }

            return false;
          }),
        // When the current block is a heading,
        // do a special splitBlock to suggest heading hierarchy.
        // Note: Horacio added this code.
        () =>
          commands.command(({state, chain}) => {
            const {blockContentType} = getBlockInfoFromSelection(state);

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;

            // if selection is not in the beginning of the heading and is a heading,
            // we need to check what we need to do
            if (!selectionAtBlockStart && blockContentType == "heading") {
              chain()
                .deleteSelection()
                .BNSplitHeadingBlock(state.selection.from)
                .run();
              return true;
            }

            return false;
          }),
        // Removes a level of nesting if the block is empty & indented,
        // while the selection is also empty & at the start of the block.
        () =>
          commands.command(({state}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const {block: blockContainer, blockContent} = blockInfo;

            const {depth} = state.doc.resolve(blockContainer.beforePos);

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockContent.node.childCount === 0;
            const blockIndented = depth > 1;

            if (
              selectionAtBlockStart &&
              selectionEmpty &&
              blockEmpty &&
              blockIndented
            ) {
              return commands.liftListItem("blockContainer");
            }

            return false;
          }),
        // Creates a new block and moves the selection to it
        // if the current one is empty, while the selection is also
        // empty & at the start of the block.
        () =>
          commands.command(({state, dispatch}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const {block: blockContainer, blockContent} = blockInfo;

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const selectionEmpty =
              state.selection.anchor === state.selection.head;
            const blockEmpty = blockContent.node.childCount === 0;

            if (selectionAtBlockStart && selectionEmpty && blockEmpty) {
              const newBlockInsertionPos = blockContainer.afterPos;
              const newBlockContentPos = newBlockInsertionPos + 2;

              if (dispatch) {
                const newBlock =
                  state.schema.nodes["blockContainer"].createAndFill()!;

                state.tr
                  .insert(newBlockInsertionPos, newBlock)
                  .scrollIntoView();
                state.tr.setSelection(
                  new TextSelection(state.doc.resolve(newBlockContentPos))
                );
              }

              return true;
            }

            return false;
          }),
        // Splits the current block, moving content inside that's
        // after the cursor to a new text block below. Also
        // deletes the selection beforehand, if it's not empty.
        () =>
          commands.command(({state, chain}) => {
            const blockInfo = getBlockInfoFromSelection(state);
            const {blockContent} = blockInfo;

            const selectionAtBlockStart =
              state.selection.$anchor.parentOffset === 0;
            const blockEmpty = blockContent.node.childCount === 0;

            if (!blockEmpty) {
              chain()
                .deleteSelection()
                .command(
                  splitBlockCommand(
                    state.selection.from,
                    selectionAtBlockStart,
                    selectionAtBlockStart
                  )
                )
                .run();

              return true;
            }

            return false;
          }),
      ]);

    const handleTab = () =>
      this.editor.commands.first(({commands}) => [
        () =>
          commands.command(({state}) => {
            // Find block group, block container, and depth it is at
            const {group, container, $pos} = getGroupInfoFromPos(
              state.selection.from,
              state
            );

            if (
              group.type.name === "blockGroup" &&
              group.attrs.listType !== "Group"
            ) {
              setTimeout(() => {
                // Try nesting the list item
                const isNested = nestBlock(
                  this.options.editor,
                  group.attrs.listType,
                  group.attrs.listType === "Unordered"
                    ? (parseInt(group.attrs.listLevel) + 1).toString()
                    : "1"
                );
                // Update list children if nesting was successful
                if (isNested)
                  this.editor
                    .chain()
                    .command(
                      updateGroupChildrenCommand(
                        group,
                        container!,
                        $pos,
                        group.attrs.listType === "Unordered"
                          ? parseInt(group.attrs.listLevel) + 1
                          : 1,
                        group.attrs.listType,
                        true
                      )
                    )
                    .run();
              });
              return true;
            }
            return false;
          }),
        () =>
          // This command is needed for tab inside of the first level of nesting
          commands.command(({state, chain}) => {
            const {group, container, $pos} = getGroupInfoFromPos(
              state.selection.from,
              state
            );

            if (container) {
              // Try sinking the list item.
              const result = chain().sinkListItem("blockContainer").run();
              // Update group children if sinking was successful.
              if (result) {
                setTimeout(() => {
                  try {
                    this.editor
                      .chain()
                      .command(
                        updateGroupChildrenCommand(
                          group,
                          container,
                          $pos,
                          parseInt(group.attrs.listLevel),
                          group.attrs.listType,
                          true
                        )
                      )
                      .run();
                  } catch (e) {
                    // @ts-expect-error
                    console.log(e.message);
                  }
                });
              }
              return true;
            } else {
              // Just sink the list item if not a list.
              commands.sinkListItem("blockContainer");
              return true;
            }
          }),
      ]);

    return {
      Backspace: handleBackspace,
      Delete: handleDelete,
      Enter: handleEnter,
      Tab: handleTab,
      "Shift-Tab": () => {
        const {block} = getBlockInfoFromSelection(this.editor.state);
        return unnestBlock(this.editor, block.beforePos + 1);
      },
      // "Shift-Mod-ArrowUp": () => {
      //   this.options.editor.moveBlocksUp();
      //   return true;
      // },
      // "Shift-Mod-ArrowDown": () => {
      //   this.options.editor.moveBlocksDown();
      //   return true;
      // },
      "Shift-ArrowLeft": () => {
        const {state, view} = this.editor;
        const {selection} = state;
        const {block} = getBlockInfoFromPos(state, selection.from - 1);
        if (selection.from <= 3) {
          return false;
        }
        if (selection.from === selection.$from.start()) {
          let currentPos = selection.from - 1;
          let currentNode = state.doc.resolve(currentPos).parent;
          let currentId = getBlockInfoFromPos(state, currentPos).block.node
            .attrs.id;
          while (
            block.node.attrs.id === currentId ||
            ["blockContainer", "blockGroup"].includes(currentNode.type.name)
          ) {
            currentPos--;
            currentNode = state.doc.resolve(currentPos).parent;
            currentId = getBlockInfoFromPos(state, currentPos).block.node.attrs
              .id;
          }
          const decoration = Decoration.widget(currentPos, () => {
            const span = document.createElement("span");
            span.style.backgroundColor = "blue";
            span.style.width = "10px";
            span.style.height = "10px";
            return span;
          });
          const decorationSet = DecorationSet.create(state.doc, [decoration]);
          view.dispatch(state.tr.setMeta(SelectionPluginKey, decorationSet));
        }
        return false;
      },
    };
  },
});
