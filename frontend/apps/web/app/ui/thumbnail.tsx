import {getFileUrl, HMMetadata, UnpackedHypermediaId} from "@shm/shared";
import {UIAvatar, UIAvatarProps} from "@shm/ui/src/avatar";
import {AlertCircle} from "@tamagui/lucide-icons";
import {YStack} from "@tamagui/stacks";

export function Thumbnail({
  id,
  metadata,
  size = 32,
  ...props
}: Omit<UIAvatarProps, "id"> & {
  id: UnpackedHypermediaId;
  metadata?: HMMetadata | null;
  size?: number;
}) {
  return (
    <UIAvatar
      size={size}
      id={id.path?.at(-1) || id.uid.slice(2)}
      label={metadata?.name}
      url={getFileUrl(metadata?.thumbnail)}
      borderRadius={id.path && id.path.length != 0 ? size / 8 : undefined}
      flexShrink={0}
      flexGrow={0}
    />
  );
}

export function ErrorDot({error}: {error?: boolean}) {
  return error ? (
    <YStack
      backgroundColor="$red11"
      display="flex"
      position="absolute"
      top={-8}
      left={-8}
      padding={0}
      paddingLeft={-4}
      width={16}
      height={16}
      borderRadius={8}
    >
      <AlertCircle size={16} />
    </YStack>
  ) : null;
}
