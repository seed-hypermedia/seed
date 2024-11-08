import {
  getDraftNodesOutline,
  getMetadataName,
  getNodesOutline,
  HMDocument,
  HMDraft,
  HMEntityContent,
  hmId,
  HMMetadata,
  HMQueryResult,
  NodeOutline,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {Hash} from "@tamagui/lucide-icons";
import {YStack} from "@tamagui/stacks";
import {GestureReponderEvent} from "@tamagui/web";
import {ReactNode, useMemo} from "react";
import {View} from "tamagui";
import {HMIcon} from "./hm-icon";
import {SmallCollapsableListItem, SmallListItem} from "./list-item";

function DocumentSmallListItem({
  metadata,
  id,
  indented,
  items,
  active,
  onPress,
}: {
  metadata?: HMMetadata;
  id: UnpackedHypermediaId;
  indented?: number;
  items?: null | ReactNode;
  active?: boolean;
  onPress?: () => void;
}) {
  const linkProps = useRouteLink({key: "document", id});
  if (items)
    return (
      <SmallCollapsableListItem
        key={id.id}
        title={getMetadataName(metadata)}
        icon={<HMIcon id={id} metadata={metadata} size={20} />}
        indented={indented}
        active={active}
        {...linkProps}
        onPress={(e) => {
          onPress?.();
          linkProps.onPress?.(e);
        }}
      >
        {items}
      </SmallCollapsableListItem>
    );
  return (
    <SmallListItem
      key={id.id}
      title={getMetadataName(metadata)}
      icon={<HMIcon id={id} metadata={metadata} size={20} />}
      indented={indented}
      active={active}
      {...linkProps}
    />
  );
}

export function SiteNavigationContent({
  documentMetadata,
  supportDocuments,
  supportQueries,
  id,
  createDirItem,
  onPress,
  outline,
}: {
  documentMetadata: HMMetadata;
  supportDocuments?: HMEntityContent[];
  supportQueries?: HMQueryResult[];
  id: UnpackedHypermediaId;
  createDirItem?: ((opts: {indented: number}) => ReactNode) | null;
  onPress?: () => void;
  outline?: (opts: {indented: number}) => ReactNode;
}) {
  const directory = supportQueries?.find((query) => query.in.uid === id.uid);
  const isHomeDoc = !id.path || id.path?.length === 0;
  const isTopLevelDoc = id.path?.length === 1;

  const parentId = hmId(id.type, id.uid, {
    path: id.path?.slice(0, -1) || [],
  });
  if (!directory) return null;
  const parentItem = directory.results.find(
    (doc) => doc.path.join("/") === parentId.path?.join("/")
  );
  const parentIdPath = parentId.path;
  const idPath = id.path;
  const siblingDocs =
    parentIdPath && !isHomeDoc
      ? directory.results.filter(
          (doc) =>
            doc.path.join("/").startsWith(parentIdPath.join("/")) &&
            parentIdPath.length === doc.path.length - 1
        )
      : null;
  const childrenDocs =
    idPath &&
    directory.results.filter(
      (doc) =>
        doc.path.join("/").startsWith(idPath.join("/")) &&
        idPath.length === doc.path.length - 1
    );
  const documentIndent = isHomeDoc || isTopLevelDoc ? 0 : 1;
  const childrenIndent = isHomeDoc ? 0 : documentIndent + 1;
  const childrenItems =
    outline || childrenDocs?.length ? (
      <>
        {outline?.({indented: childrenIndent})}
        {childrenDocs
          ? childrenDocs.map((doc) => (
              <DocumentSmallListItem
                key={doc.path.join("/")}
                metadata={doc.metadata}
                id={hmId("d", doc.account, {path: doc.path})}
                onPress={onPress}
                indented={childrenIndent}
              />
            ))
          : null}
        {createDirItem?.({indented: childrenIndent})}
      </>
    ) : null;
  return (
    <YStack gap="$2" paddingLeft="$4">
      {isHomeDoc || isTopLevelDoc || !parentItem ? null : (
        <DocumentSmallListItem
          metadata={parentItem.metadata}
          id={parentId}
          onPress={onPress}
        />
      )}

      {siblingDocs?.flatMap((doc) => {
        if (idPath && doc.path.join("/") === idPath.join("/"))
          return [
            <DocumentSmallListItem
              metadata={documentMetadata}
              id={id}
              key={id.id}
              indented={documentIndent}
              onPress={onPress}
              active={doc.path.join("/") === id.path?.join("/") && !id.blockRef}
              items={childrenItems}
            />,
          ];

        return [
          <DocumentSmallListItem
            key={doc.path.join("/")}
            metadata={doc.metadata}
            id={hmId("d", doc.account, {path: doc.path})}
            onPress={onPress}
            indented={documentIndent}
          />,
        ];
      })}

      {isHomeDoc ? childrenItems : null}
    </YStack>
  );
}

export function DocumentOutline({
  document,
  indented,
  onActivateBlock,
  onPress,
  id,
  supportDocuments,
  activeBlockId,
}: {
  document: HMDocument;
  indented?: number;
  onActivateBlock: (blockId: string) => void;
  onPress?: () => void;
  id: UnpackedHypermediaId;
  supportDocuments?: HMEntityContent[];
  activeBlockId: string | null;
}) {
  const outline = useMemo(() => {
    return getNodesOutline(document.content, id, supportDocuments);
  }, [id, document.content, supportDocuments]);
  return outline.map((node) => (
    <OutlineNode
      node={node}
      key={node.id}
      indented={indented}
      onActivateBlock={onActivateBlock}
      onPress={onPress}
      activeBlockId={activeBlockId}
    />
  ));
}

export function DraftOutline({
  draft,
  id,
  supportDocuments,
  onActivateBlock,
  indented,
  onPress,
}: {
  draft: HMDraft;
  id: UnpackedHypermediaId;
  supportDocuments: HMEntityContent[];
  onActivateBlock: (blockId: string) => void;
  indented?: number;
  onPress?: () => void;
}) {
  const outline = useMemo(() => {
    return getDraftNodesOutline(draft.content, id, supportDocuments);
  }, [id, draft.content, supportDocuments]);
  console.log("DraftOutline", draft, outline);
  return outline.map((node) => (
    <OutlineNode
      node={node}
      key={node.id}
      indented={indented}
      onActivateBlock={onActivateBlock}
      onPress={onPress}
      activeBlockId={null}
    />
  ));
}

function OutlineNode({
  node,
  indented = 0,
  activeBlockId,
  onActivateBlock,
  onPress,
}: {
  node: NodeOutline;
  indented?: number;
  activeBlockId: string | null;
  onActivateBlock: (blockId: string) => void;
  onPress?: () => void;
}) {
  return (
    <>
      <SmallListItem
        key={node.id}
        active={node.id === activeBlockId}
        title={node.title}
        icon={
          <View width={16}>
            {node.icon ? (
              <node.icon color="$color9" size={16} />
            ) : (
              <Hash color="$color9" size={16} />
            )}
          </View>
        }
        indented={indented}
        onPress={(e: GestureReponderEvent) => {
          e.preventDefault();
          onPress?.();
          onActivateBlock(node.id);
        }}
      />
      {node.children?.length
        ? node.children.map((child) => (
            <OutlineNode
              node={child}
              key={child.id}
              indented={indented + 1}
              activeBlockId={activeBlockId}
              onActivateBlock={onActivateBlock}
              onPress={onPress}
            />
          ))
        : null}
    </>
  );
}
