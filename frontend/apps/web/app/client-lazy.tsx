import { lazy, useEffect, useState } from "react";
import { WebCommentingProps } from "./commenting";

function clientLazy<ComponentProps extends {}>(
  doImport: () => Promise<{ default: React.FC<ComponentProps> }>
) {
  const ClientComponent = lazy(doImport);
  function ClientAwokenComponent(props: ComponentProps) {
    const [isClientAwake, setIsClientAwake] = useState(false);
    useEffect(() => {
      setIsClientAwake(true);
    }, []);
    // @ts-expect-error
    return isClientAwake ? <ClientComponent {...props} /> : null;
  }
  return ClientAwokenComponent;
}

export const WebCommenting = clientLazy<WebCommentingProps>(async () => ({
  default: (await import("./commenting")).default,
}));

export const AccountFooterActionsLazy = clientLazy<{}>(async () => ({
  default: (await import("./auth")).AccountFooterActions,
}));

// Children of this component will only be rendered on the client side.
export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null;

  return <>{children}</>;
}
