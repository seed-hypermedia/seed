import { hmId, useRouteLink } from "@shm/shared";
import { useAccount } from "@shm/shared/models/entity";
import { HMIcon } from "@shm/ui/hm-icon";
import useMedia from "@shm/ui/use-media";
import { cn } from "@shm/ui/utils";
import { CircleUser } from "lucide-react";
import { useCreateAccount, useLocalKeyPair } from "./auth";

const COMMON_BUBBLE_CLASSES =
  "sticky bottom-4 left-4 z-10 mt-auto mb-4 flex hidden self-start shadow-lg";

export function MyAccountBubble() {
  const media = useMedia();
  const keyPair = useLocalKeyPair();
  const myAccount = useAccount(keyPair?.id || undefined);
  const linkProps = useRouteLink(
    keyPair
      ? {
          key: "profile",
          id: hmId(keyPair.id, {
            latest: true,
          }),
        }
      : null
  );
  if (!media.gtSm) {
    return null;
  }
  if (!keyPair) {
    return <CreateAccountBubble />;
  }
  return (
    <a
      className={cn(COMMON_BUBBLE_CLASSES, "hidden rounded-full sm:flex")}
      {...linkProps}
    >
      <HMIcon
        id={hmId(keyPair.id)}
        name={myAccount.data?.metadata?.name}
        icon={myAccount.data?.metadata?.icon}
        size={32}
      />
    </a>
  );
}

function CreateAccountBubble() {
  const { createAccount, content } = useCreateAccount({
    onClose: () => {},
  });
  return (
    <>
      <button
        className={cn(
          COMMON_BUBBLE_CLASSES,
          "items-center gap-2 rounded-lg bg-white p-2 font-bold transition-colors hover:bg-gray-100 sm:flex dark:bg-gray-800"
        )}
        onClick={() => {
          createAccount();
        }}
      >
        <CircleUser className="size-4" />
        Join
      </button>
      {content}
    </>
  );
}
