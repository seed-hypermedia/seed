import {toPlainMessage} from "@bufbuild/protobuf";
import type {MetaFunction} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {Text} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";
import {queryClient} from "../client";

export const meta: MetaFunction = () => {
  return [
    {title: "Seed Hypermedia"},
    // {name: "description", content: "Welcome to Remix!"},
  ];
};

export const loader = async () => {
  const allEntities = await queryClient.entities.searchEntities({});
  return {entities: toPlainMessage(allEntities).entities};
};

export default function Index() {
  const l = useLoaderData<typeof loader>();

  return (
    <YStack>
      {l.entities.map((entity) => {
        return (
          <Text key={entity.id}>
            {entity.title} - {entity.id}
          </Text>
        );
      })}
    </YStack>
  );
}
