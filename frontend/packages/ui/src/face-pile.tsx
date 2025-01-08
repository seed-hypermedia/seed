import {HMMetadata} from "@shm/shared/src/hm-types";
import {UnpackedHypermediaId} from "@shm/shared/src/utils/entity-id-url";
import {Text} from "@tamagui/core";
import {XStack} from "@tamagui/stacks";
import {useMemo} from "react";
import {HMIcon} from "./hm-icon";

export type AccountMetadata = {
  id: UnpackedHypermediaId;
  metadata?: HMMetadata;
};

export type AccountsMetadata = Record<
  string, // account uid
  AccountMetadata
>;

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
        const authorInfo = accountsMetadata[author];
        if (!authorInfo) return null;
        return (
          <XStack
            zIndex={idx + 1}
            key={showAccountIds[idx]}
            borderColor="$background"
            backgroundColor="$background"
            // $group-item-hover={{
            //   borderColor: itemHoverBgColor,
            //   backgroundColor: itemHoverBgColor,
            // }}
            borderWidth={2}
            borderRadius={100}
            overflow="hidden"
            marginLeft={-8}
            animation="fast"
          >
            <HMIcon
              key={authorInfo.id.uid}
              id={authorInfo.id}
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
