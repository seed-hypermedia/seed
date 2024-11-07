import {
  getMetadataName,
  getNodesOutline,
  HMDocument,
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
  document,
  supportDocuments,
  supportQueries,
  id,
  createDirItem,
  onPress,
  onActivateBlock,
}: {
  document: HMDocument;
  supportDocuments?: HMEntityContent[];
  supportQueries?: HMQueryResult[];
  id: UnpackedHypermediaId;
  createDirItem?: ReactNode;
  onPress?: () => void;
  onActivateBlock: (blockId: string) => void;
}) {
  const outline = useMemo(() => {
    return getNodesOutline(document.content, id, supportDocuments);
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
  console.log("siblingDocs", siblingDocs);
  return (
    <YStack gap="$2" paddingLeft="$4">
      {isTopLevel || !parentListItem ? null : (
        <DocumentSmallListItem
          metadata={parentListItem.metadata}
          id={parentId}
          onPress={onPress}
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
              onPress={onPress}
              active={doc.path.join("/") === id.path?.join("/") && !id.blockRef}
              items={
                outline.length || childrenDocs?.length ? (
                  <>
                    {...outline.map((node) => (
                      <OutlineNode
                        node={node}
                        key={node.id}
                        indented={documentIndent + 1}
                        onActivateBlock={onActivateBlock}
                        onPress={onPress}
                        activeBlockId={id.blockRef}
                      />
                    ))}
                    {childrenDocs
                      ? childrenDocs.map((doc) => (
                          <DocumentSmallListItem
                            key={doc.path.join("/")}
                            metadata={doc.metadata}
                            id={hmId("d", doc.account, {path: doc.path})}
                            onPress={onPress}
                            indented={documentIndent + 1}
                          />
                        ))
                      : null}
                    {createDirItem}
                  </>
                ) : null
              }
            />,
          ];

        return [
          <DocumentSmallListItem
            key={doc.path.join("/")}
            metadata={doc.metadata}
            id={hmId("d", doc.account, {path: doc.path})}
            onPress={onPress}
            indented={1}
          />,
        ];
      })}

      {isTopLevel ? createDirItem : null}
    </YStack>
  );
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
