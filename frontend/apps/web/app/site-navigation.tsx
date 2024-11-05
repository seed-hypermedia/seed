import {
  getMetadataName,
  getNodesOutline,
  HMDocument,
  hmId,
  HMMetadata,
  HMQueryResult,
  NodeOutline,
  UnpackedHypermediaId,
} from "@shm/shared";
import {useRouteLink} from "@shm/shared/src/routing";
import "@shm/shared/src/styles/document.css";
import {HMIcon} from "@shm/ui/src/hm-icon";
import {SmallListItem} from "@shm/ui/src/list-item";
import {GestureReponderEvent} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {useMemo} from "react";

export function SiteNavigation({
  document,
  supportDocuments,
  supportQueries,
  onClose,
  id,
}: {
  document: HMDocument;
  onClose?: () => void;
  supportDocuments?: {id: UnpackedHypermediaId; document: HMDocument}[];
  supportQueries?: HMQueryResult[];
  id: UnpackedHypermediaId;
}) {
  const outline = useMemo(() => {
    return getNodesOutline(document.content);
  }, [document.content]);

  const directory = supportQueries?.find(
    (query) => query.in.uid === document.account
  );
  const isTopLevel = !id.path || id.path?.length === 0;

  const parentId = hmId(id.type, id.uid, {
    path: id.path?.slice(0, -1) || [],
  });
  if (!directory) return null;
  const parentListItem = directory.results.find(
    (doc) => doc.path.join("/") === parentId.path?.join("/")
  );
  const parentIdPath = parentId.path;
  const idPath = id.path;
  const siblingDocs =
    parentIdPath &&
    directory.results.filter(
      (doc) =>
        doc.path.join("/").startsWith(parentIdPath.join("/")) &&
        parentIdPath.length === doc.path.length - 1
    );
  const childrenDocs =
    idPath &&
    directory.results.filter(
      (doc) =>
        doc.path.join("/").startsWith(idPath.join("/")) &&
        idPath.length === doc.path.length - 1
    );
  const documentIndent = isTopLevel ? 0 : 1;

  return (
    <YStack gap="$2" paddingLeft="$4">
      {isTopLevel || !parentListItem ? null : (
        <DocumentSmallListItem
          metadata={parentListItem.metadata}
          id={parentId}
        />
      )}

      {siblingDocs?.flatMap((doc) => {
        if (idPath && doc.path.join("/") === idPath.join("/"))
          return [
            <DocumentSmallListItem
              metadata={document.metadata}
              id={id}
              key={id.id}
              indented={documentIndent}
            />,
            ...outline.map((node) => (
              <OutlineNode
                node={node}
                key={node.id}
                onClose={onClose}
                indented={documentIndent}
              />
            )),
            childrenDocs?.map((doc) => (
              <DocumentSmallListItem
                key={doc.path.join("/")}
                metadata={doc.metadata}
                id={hmId("d", doc.account, {path: doc.path})}
                indented={2}
              />
            )),
          ];

        return [
          <DocumentSmallListItem
            key={doc.path.join("/")}
            metadata={doc.metadata}
            id={hmId("d", doc.account, {path: doc.path})}
            indented={1}
          />,
        ];
      })}
    </YStack>
  );
}

function OutlineNode({
  node,
  onClose,
  indented = 0,
}: {
  node: NodeOutline;
  onClose?: () => void;
  indented?: number;
}) {
  return (
    <>
      <SmallListItem
        key={node.id}
        title={node.title}
        // icon={<HMIcon id={node.id} metadata={node.metadata} size={20} />}
        indented={indented}
        onPress={(e: GestureReponderEvent) => {
          e.preventDefault();
          const targetElement = document.querySelector(`#${node.id}`);

          if (targetElement) {
            const offset = 80; // header fixed height
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.scrollY - offset;
            window.scrollTo({top: offsetPosition, behavior: "smooth"});
            onClose?.();
          }
        }}
      />
      {node.children?.length
        ? node.children.map((child) => (
            <OutlineNode node={child} key={child.id} indented={indented + 1} />
          ))
        : null}
    </>
  );
}

function DocumentSmallListItem({
  metadata,
  id,
  indented,
}: {
  metadata?: HMMetadata;
  id: UnpackedHypermediaId;
  indented?: number;
}) {
  const linkProps = useRouteLink({key: "document", id});
  return (
    <SmallListItem
      key={id.id}
      title={getMetadataName(metadata)}
      icon={<HMIcon id={id} metadata={metadata} size={20} />}
      indented={indented}
      {...linkProps}
    />
  );
}
