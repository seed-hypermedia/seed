import {toPlainMessage} from "@bufbuild/protobuf";
import type {MetaFunction} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {UIAvatar} from "@shm/ui/src/avatar";
import {Button} from "@tamagui/button";
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
      <UIAvatar />
      {l.entities.map((entity) => {
        return (
          <Text key={entity.id}>
            {entity.title} - {entity.id}
          </Text>
        );
      })}
      <Button onPress={() => alert("pressed")}>Press m1e</Button>
    </YStack>
  );
}
