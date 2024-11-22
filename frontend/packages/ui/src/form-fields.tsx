import {Label} from "@tamagui/label";
import {YStack} from "@tamagui/stacks";
import {PropsWithChildren} from "react";

export function Field({
  id,
  label,
  children,
}: PropsWithChildren<{label: string; id: string}>) {
  return (
    <YStack gap="$1" f={1}>
      <Label htmlFor={id} size="$1" color="$color9">
        {label}
      </Label>
      {children}
    </YStack>
  );
}
