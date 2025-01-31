import {
  BlockNoteEditor,
  getBlockInfoFromPos,
  getBlockInfoFromSelection,
  setGroupTypes,
} from "@";
import {Editor, Extension} from "@tiptap/core";
import {Fragment, Node} from "@tiptap/pm/model";
import {Plugin} from "prosemirror-state";
import {getPrevBlockInfo} from "../../api/blockManipulation/commands/mergeBlocks";
import {MarkdownToBlocks} from "./MarkdownToBlocks";

function containsMarkdownSymbols(pastedText: string) {
  // Regex to detect unique Markdown symbols at the start of a line
  const markdownUniqueSymbols = new RegExp(
    [
      "^#{1,6} ", // Headers
      "^[\\s]*[-+*] ", // Unordered Lists
      "^\\d+\\. ", // Ordered Lists
      "^[\\s]*> ", // Blockquotes
      "^```", // Code Fences
      "^`[^`]+`$", // Inline Code
      "^\\[([^\\]]+)\\]\\(([^)]+)\\)$", // Links
      "^!\\[([^\\]]*)\\]\\(([^)]+)\\)$", // Images
      "^(\\*\\*|__)(.*?)\\1$",
      "^(\\*|_)(.*?)\\1$",
    ].join("|"),
    "m"
  );

  // Split the text by lines and check each line
  const lines = pastedText.split("\n").map((line) => line.trim());

  // Ensure that at least one line contains valid Markdown symbols
  return lines.some((line) => markdownUniqueSymbols.test(line));
}

// Function to insert a group, if it is the only node being pasted.
function replaceSelectedBlock(group: Node, editor: Editor) {
  const {state, view} = editor;
  const blockInfo = getBlockInfoFromSelection(state);
  // Check whether the block is empty.
  if (!state.selection.$from.parent.content.content.length) {
    const prevBlockInfo = getPrevBlockInfo(
      state.doc,
      blockInfo.block.beforePos
    );
    // Insert the pasted group content at the end of the previous block's child group,
    // or add a child group to the previous block.
    if (prevBlockInfo) {
      const {block, childContainer} = prevBlockInfo;
      const newBlock = state.schema.nodes["blockContainer"].create(
        block.node.attrs,
        childContainer
          ? [
              block.node.firstChild!,
              state.schema.nodes["blockGroup"].create(
                childContainer.node.attrs,
                [
                  ...childContainer.node.content.content,
                  ...group.content.content,
                ]
              ),
            ]
          : block.node.content.addToEnd(group)
      );
      // setTimeout(() => {
      view.dispatch(
        state.tr.replaceRangeWith(
          block.beforePos + 1,
          block.afterPos - 1,
          newBlock
        )
      );
      // })

      return true;
    }
    // Add the group's content to the child group selected. The selected block will be the
    // first child of the child group, because otherwise the first 'if' check would pass.
    else if (state.selection.$from.depth > 3) {
      const parentBlockInfo = getBlockInfoFromPos(
        state,
        state.selection.$from.start() - 4
      );
      const {block, childContainer} = parentBlockInfo;
      const newBlock = state.schema.nodes["blockContainer"].create(
        block.node.attrs,
        [block.node.firstChild!, group]
      );

      // setTimeout(() => {
      view.dispatch(
        state.tr.replaceRangeWith(
          block.beforePos + 1,
          block.afterPos - 1,
          newBlock
        )
      );
      // })
      return true;
    }
  }
  return false;
}

// Get nodes of a fragment or block group to be pasted
function getPastedNodes(parent: Node | Fragment, editor: Editor) {
  const nodes: Node[] = [];
  parent.forEach((node) => {
    if (node.type.name === "blockGroup") {
      const prevContainer = nodes.pop();
      if (prevContainer) {
        const container = editor.schema.nodes["blockContainer"].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node)
        );
        nodes.push(container);
      }
    } else if (node.type.name !== "blockContainer") {
      let nodeToInsert = node;
      if (node.type.name === "text") {
        nodeToInsert = editor.schema.nodes.paragraph.create({}, node);
      }
      const container = editor.schema.nodes["blockContainer"].create(
        null,
        nodeToInsert
      );
      nodes.push(container);
    } else if (node.firstChild!.type.name === "blockGroup") {
      const prevContainer = nodes.pop();
      if (prevContainer) {
        const container = editor.schema.nodes["blockContainer"].create(
          prevContainer.attrs,
          prevContainer.content.addToEnd(node.firstChild!)
        );
        nodes.push(container);
      } else if (!replaceSelectedBlock(node.firstChild!, editor)) {
        nodes.push(node.firstChild!);
      }
    } else nodes.push(node);
  });
  return nodes;
}

export const createMarkdownExtension = (bnEditor: BlockNoteEditor) => {
  const MarkdownExtension = Extension.create({
    name: "MarkdownPasteHandler",
    priority: 25,

    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handlePaste: (view, event, slice) => {
              const selectedNode = view.state.selection.$from.parent;
              // Don't proceed if pasting into code block
              if (
                selectedNode.type.name === "code-block" ||
                selectedNode.firstChild?.type.name === "code-block"
              ) {
                return false;
              }
              const pastedText = event.clipboardData!.getData("text/plain");
              const pastedHtml = event.clipboardData!.getData("text/html");
              const hasList =
                pastedHtml.includes("<ul") || pastedHtml.includes("<ol");

              const {state} = view;
              const {selection} = state;

              const isMarkdown = pastedHtml
                ? containsMarkdownSymbols(pastedText)
                : pastedText
                ? true
                : false;

              // console.log('is markdown and has list', isMarkdown, hasList)

              // console.log('pasted text and html', pastedText, pastedHtml)

              if (!isMarkdown) {
                if (hasList) {
                  // const parser = new DOMParser()
                  // const doc = parser.parseFromString(pastedHtml, 'text/html')
                  // const ulElement = doc.body.querySelector('ul')
                  // const olElement = doc.body.querySelector('ol')
                  // const findPositions = [
                  //   {node: ulElement!, offset: 0},
                  //   {node: olElement!, offset: 0},
                  // ]
                  // const fragment = ProseMirrorDOMParser.fromSchema(
                  //   view.state.schema,
                  // ).parse(doc.body, {
                  //   findPositions: findPositions,
                  // })

                  // If pasting HM editor content, first block will be block group
                  const firstBlockGroup =
                    slice.content.firstChild?.type.name === "blockGroup";
                  const nodes: Node[] = getPastedNodes(
                    firstBlockGroup ? slice.content.firstChild : slice.content,
                    this.editor
                  );

                  if (nodes.length) {
                    const root = this.editor.schema.nodes["blockGroup"].create(
                      {},
                      nodes
                    );
                    let tr = state.tr;
                    tr = tr.replaceRangeWith(
                      selection.from,
                      selection.to,
                      // @ts-ignore
                      root.content.content
                    );
                    view.dispatch(tr);
                  }
                  return true;
                }
                return false;
              }

              MarkdownToBlocks(pastedText, bnEditor).then((organizedBlocks) => {
                const blockInfo = getBlockInfoFromSelection(state);

                bnEditor.replaceBlocks(
                  [blockInfo.block.node.attrs.id],
                  // @ts-ignore
                  organizedBlocks
                );
                setGroupTypes(bnEditor._tiptapEditor, organizedBlocks);
              });

              return true;
            },
          },
        }),
      ];
    },
  });

  return MarkdownExtension;
};
