import {hmId, HMMetadata} from "@shm/shared";
import {useMemo} from "react";
import {Text, XStack} from "tamagui";
import {LinkThumbnail} from "./thumbnail";
import {itemHoverBgColor} from "./ui-constants";

export type AccountsMetadata = {
  uid: string;
  metadata?: HMMetadata;
}[];

export function FacePile({
  accounts,
  accountsMetadata,
}: {
  accounts: string[];
  accountsMetadata: AccountsMetadata;
}) {
  const showAccountIds = useMemo(
    () => (accounts.length > 3 ? accounts.slice(0, 2) : accounts),
    [accounts]
  );
  return (
    <>
      {showAccountIds.map((author, idx) => {
        const authorInfo = accountsMetadata.find(
          (authorMetadata: any) => authorMetadata.uid === author
        );
        if (!authorInfo) return null;
        return (
          <XStack
            zIndex={idx + 1}
            key={showAccountIds[idx]}
            borderColor="$background"
            backgroundColor="$background"
            $group-item-hover={{
              borderColor: itemHoverBgColor,
              backgroundColor: itemHoverBgColor,
            }}
            borderWidth={2}
            borderRadius={100}
            overflow="hidden"
            marginLeft={-8}
            animation="fast"
          >
            <LinkThumbnail
              key={authorInfo.uid}
              id={hmId("d", authorInfo.uid)}
              metadata={authorInfo.metadata}
              size={20}
            />
          </XStack>
        );
      })}
      {accounts.length > 2 ? (
        <XStack
          zIndex="$zIndex.1"
          borderColor="$background"
          backgroundColor="$background"
          borderWidth={2}
          borderRadius={100}
          marginLeft={-8}
          animation="fast"
          width={24}
          height={24}
          ai="center"
          jc="center"
        >
          <Text
            fontSize={10}
            fontFamily="$body"
            fontWeight="bold"
            color="$color10"
          >
            +{accounts.length - 3}
          </Text>
        </XStack>
      ) : null}
    </>
  );
}
