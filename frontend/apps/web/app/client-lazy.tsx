import {lazy, useEffect, useState} from "react";
import {WebCommentingProps} from "./commenting";

function clientLazy<ComponentProps extends {}>(
  doImport: () => Promise<{default: React.FC<ComponentProps>}>
) {
  // @ts-expect-error
  const ClientComponent = lazy(doImport);
  function ClientAwokenComponent(props: ComponentProps) {
    const [isClientAwake, setIsClientAwake] = useState(false);
    useEffect(() => {
      setIsClientAwake(true);
    }, []);
    return isClientAwake ? <ClientComponent {...props} /> : null;
  }
  return ClientAwokenComponent;
}

export const WebCommenting = clientLazy<WebCommentingProps>(async () => ({
  default: (await import("./commenting")).default,
}));

export const WebIdentityFooter = clientLazy<{}>(async () => ({
  default: (await import("./commenting")).FooterActions,
}));
