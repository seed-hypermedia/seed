import {useLowlight} from "@shm/shared";
import {common} from "lowlight";
import {createElement} from "react";

export function Code({text, language}: {language: string; text: string}) {
  const lowlight = useLowlight(common);

  const nodes: any[] =
    language && language.length
      ? getHighlightNodes(lowlight.highlight(language, text))
      : [];
  let res = (
    <code>
      {nodes.length
        ? nodes.map((node, index) => <CodeHighlight key={index} node={node} />)
        : text}
    </code>
  );
  return res;
}

const CodeHighlight = ({node}: {node: any}) => {
  if (node.type === "text") {
    return node.value;
  }

  if (node.type === "element") {
    const {tagName, properties, children} = node;
    if (properties.className && Array.isArray(properties.className)) {
      properties.className = properties.className[0];
    }
    return createElement(
      tagName,
      {...properties},
      children &&
        children.map((child: any, index: number) => (
          <CodeHighlight key={index} node={child} />
        ))
    );
  }

  return null;
};

function getHighlightNodes(result: any) {
  return result.value || result.children || [];
}
