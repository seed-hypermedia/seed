import {PlainMessage, Timestamp} from "@bufbuild/protobuf";
import {Container} from "@shm/ui/src/container";
import {BannerNewspaperCard, NewspaperCard} from "@shm/ui/src/newspaper";
import {XStack, YStack} from "@tamagui/stacks";
import {SiteDocumentPayload} from "./loaders";
import {SiteHeader} from "./page-header";

export function NewspaperPage(props: SiteDocumentPayload) {
  const {
    document,
    homeId,
    homeMetadata,
    id,
    supportDocuments,
    supportQueries,
    authors,
    siteHost,
  } = props;
  if (!id) return null;
  if (!document) return null;
  if (document.metadata.layout !== "Seed/Experimental/Newspaper") {
    return null;
  }
  const newsQuery = supportQueries?.find((q) => {
    return q.in.uid === id.uid && q.in.path?.join("/") === id.path?.join("/");
  });
  if (!newsQuery) return null;
  console.log({supportDocuments, supportQueries});

  function getEntity(path: string[]) {
    return supportDocuments?.find(
      (item) => item?.id?.path?.join("/") === path?.join("/")
    );
  }
  const latest = newsQuery.results
    ? [...newsQuery.results].sort(lastUpdateSort)
    : [];
  const firstItem = latest[0];
  const restItems = latest.slice(1);

  return (
    <>
      <YStack marginBottom={300} paddingTop={86}>
        <SiteHeader
          homeMetadata={homeMetadata}
          homeId={homeId}
          docMetadata={document.metadata}
          docId={id}
          // authors={authors}
          // updateTime={document.updateTime}
          breadcrumbs={props.breadcrumbs}
          // openSheet={() => {
          //   setOpen(!open);
          // }}
        />
        <Container clearVerticalSpace>
          {firstItem && (
            <BannerNewspaperCard
              item={firstItem}
              entity={getEntity(firstItem.path)}
              accountsMetadata={authors}
            />
          )}
          <XStack
            flexWrap="wrap"
            gap="$4"
            marginTop="$4"
            justifyContent="center"
          >
            {restItems.map((item) => {
              return (
                <NewspaperCard
                  item={item}
                  entity={getEntity(item.path)}
                  key={item.path.join("/")}
                  accountsMetadata={authors}
                />
              );
            })}
          </XStack>
          {/* <BannerNewspaperCard /> */}
        </Container>
      </YStack>
    </>
  );
}

function lastUpdateSort(
  a: {updateTime?: PlainMessage<Timestamp>},
  b: {updateTime?: PlainMessage<Timestamp>}
) {
  return lastUpdateOfEntry(b) - lastUpdateOfEntry(a);
}

function lastUpdateOfEntry(entry: {updateTime?: PlainMessage<Timestamp>}) {
  return entry.updateTime?.seconds ? Number(entry.updateTime?.seconds) : 0;
}
