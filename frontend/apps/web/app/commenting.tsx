import {base58} from "@scure/base";
import {SITE_BASE_URL, UnpackedHypermediaId} from "@shm/shared";
import {useAppDialog} from "@shm/ui/src/universal-dialog";
import {Button} from "@tamagui/button";
import {Input} from "@tamagui/input";
import {Heading} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {decode as cborDecode} from "cbor2";
import {useRef, useState, useSyncExternalStore} from "react";
import {z} from "zod";

const userIdentitySchema = z.object({
  username: z.string(),
  publicKey: z.string(),
  credId: z.string(),
});
const userIdentityHandlers = new Set<() => void>();
let userIdState: z.infer<typeof userIdentitySchema> | null = null;
try {
  const identity = localStorage.getItem("userIdentity");
  if (identity && identity !== "null") {
    userIdState = userIdentitySchema.parse(JSON.parse(identity));
  }
} catch (error) {
  console.error(error);
}
const displaySiteUrl = SITE_BASE_URL?.replace(/^https?:\/\//, "") // strip protocol
  .replace(/\/$/, "");
const userIdentity = {
  get: () => userIdState,
  listen: (callback: () => void) => {
    userIdentityHandlers.add(callback);
    return () => {
      userIdentityHandlers.delete(callback);
    };
  },
};
function setUserIdentity(identity: z.infer<typeof userIdentitySchema> | null) {
  localStorage.setItem("userIdentity", JSON.stringify(identity));
  userIdState = identity;
  userIdentityHandlers.forEach((callback) => callback());
}
async function registerPasskey({
  challenge,
  userId,
  displayName,
}: {
  challenge: any;
  userId: string;
  displayName: string;
}) {
  const challengeData = new TextEncoder().encode(JSON.stringify(challenge));
  const userIdData = new TextEncoder().encode(userId);

  if (!SITE_BASE_URL) {
    throw new Error("No SITE_BASE_URL");
  }
  const existingUser = await getAPI(`/hm/api/users/${userId}`).catch(
    () => null
  );
  if (existingUser) {
    throw new Error("User already exists");
  }

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: challengeData,
    rp: {
      id: SITE_BASE_URL, // not working on localhost
      // id: "localhost",
      name: `Site at ${displaySiteUrl}`,
    },
    user: {
      id: userIdData,
      name: `${userId}@${displaySiteUrl}`,
      displayName: displayName,
    },
    pubKeyCredParams: [
      {type: "public-key", alg: -7}, // ES256
      {type: "public-key", alg: -257}, // RS256
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      // authenticatorAttachment: "platform",
      residentKey: "required",
      // requireResidentKey: true,
      // userVerification: "preferred",
    },
  };

  try {
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });
    if (!credential) {
      throw new Error("No credential");
    }
    console.log("cred rawId", credential.rawId);
    const credId = base58.encode(new Uint8Array(credential.rawId));
    const authenticatorResponse: AuthenticatorResponse = credential.response;
    const clientDataJSON = new TextDecoder().decode(
      authenticatorResponse.clientDataJSON
    );
    console.log("authenticatorResponse", authenticatorResponse);
    const clientData = JSON.parse(clientDataJSON);
    console.log("clientData", clientData);
    // Decode the attestation object
    const attObj = cborDecode(
      new Uint8Array(authenticatorResponse.attestationObject)
    );
    console.log("attObj", attObj);
    const authData: Uint8Array = attObj.authData;
    let offset = 0;

    // Skip RP hash, flags, signCount
    offset += 32 + 1 + 4;

    // Skip AAGUID (16 bytes)
    offset += 16;

    // Get credential ID length (2 bytes)
    const credIdLen = (authData[offset] << 8) | authData[offset + 1];
    offset += 2;

    // Skip credential ID
    offset += credIdLen;

    const publicKey = authData.slice(offset);
    const publicKeyB58 = base58.encode(publicKey);

    // The signature is in the attestation statement
    const signature = attObj.attStmt.sig;

    console.log("will register", userId, publicKeyB58);

    const apiRes = await postAPI("/hm/api/users", {
      username: userId,
      // displayName,
      credId,
      publicKey: publicKeyB58,
    });

    setUserIdentity({
      username: userId,
      publicKey: publicKeyB58,
      credId,
    });

    console.log("Registered:", {
      apiRes,
      credential,
      authenticatorResponse,
      signature,
      credId,
      publicKeyB58,
      challengeData,
    });
    return {
      // credential,
      challenge,
      userId,
      displayName,
    };
  } catch (err) {
    console.error("Registration error:", err);
  }
}

async function loginPasskey({username}: {username: string}) {
  const getUserRes = await getAPI(`/hm/api/users/${username}`);
  console.log("getUserRes", getUserRes);

  const userId = userIdentitySchema.parse(getUserRes);
  setUserIdentity(userId);
}

async function signWithIdentity(
  identity: z.infer<typeof userIdentitySchema>,
  data: any
) {
  const challengeData = new TextEncoder().encode(JSON.stringify(data));

  const userIdData = base58.decode(identity.credId);

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: challengeData,
    rpId: SITE_BASE_URL,
    timeout: 60000,
    allowCredentials: [
      {
        id: userIdData,
        type: "public-key",
      },
    ],
    // authenticatorSelection
    userVerification: "preferred",
  };

  try {
    const cred = await navigator.credentials.get({publicKey});
    if (!cred) return null;
    const postData = {
      data,
      username: identity.username,
      hostname: SITE_BASE_URL,
      id: identity.credId,
      type: cred.type,
      response: {
        clientDataJSON: bufferToB58(cred.response.clientDataJSON),
        authenticatorData: bufferToB58(cred.response.authenticatorData),
        signature: bufferToB58(cred.response.signature),
      },
    };
    console.log("cred data", postData);
    const result = await postAPI("/hm/api/comment", postData);
    console.log("comment resp", result);
    return true;
  } catch (err) {
    console.error("Login error:", err);
  }
}

function bufferToB58(buf: Buffer) {
  return base58.encode(new Uint8Array(buf));
}

async function postAPI(path: string, body: any) {
  const response = await fetch(`${SITE_BASE_URL}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
  return await response.json();
}

async function getAPI(path: string) {
  const response = await fetch(`${SITE_BASE_URL}${path}`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch");
  }
  return await response.json();
}

function AuthDialogContent({
  input,
  onClose,
}: {
  input: {comment: any};
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login" | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const userId = useSyncExternalStore(userIdentity.listen, userIdentity.get);
  if (userId) {
    return (
      <YStack gap="$2">
        <SizableText>
          Comment as "{userId?.username}@{displaySiteUrl}"
        </SizableText>
        <Button
          onPress={() => {
            signWithIdentity(userId, input.comment);
          }}
        >
          Sign and Post Comment
        </Button>
      </YStack>
    );
  }
  if (!mode) {
    return (
      <YStack gap="$2">
        <Heading>Authenticate on {displaySiteUrl}</Heading>
        <SizableText>Do you have an account here?</SizableText>
        <XStack gap="$2">
          <Button onPress={() => setMode("register")}>Create Account</Button>
          <Button onPress={() => setMode("login")}>Login</Button>
        </XStack>
      </YStack>
    );
  }
  if (mode === "register") {
    return (
      <YStack gap="$2">
        <Input ref={usernameRef} />
        <Button
          theme="brand"
          onPress={() => {
            const username = usernameRef.current?.value;
            if (!username) return;
            registerPasskey({
              challenge: {junk: true},
              userId: username,
              displayName: username,
            })
              .then((result) => {
                console.log("DID RESULT", result);
              })
              .catch((err) => {
                console.error("DID ERROR", err);
              });
          }}
        >
          Register
        </Button>
      </YStack>
    );
  }
  if (mode === "login") {
    return (
      <XStack gap="$2">
        <Input ref={usernameRef} />
        <Button
          onPress={() => {
            const username = usernameRef.current?.value;
            if (!username) return;
            loginPasskey({
              username,
            })
              .then((result) => {
                console.log("LOGIN RESULT", result);
              })
              .catch((err) => {
                console.error("LOGIN ERROR", err);
              });
          }}
        >
          Log In
        </Button>
      </XStack>
    );
  }
  return <SizableText>Huh?</SizableText>;
}

function useAuthDialog() {
  return useAppDialog(AuthDialogContent, {});
}

export default function WebCommenting({docId}: {docId: UnpackedHypermediaId}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const userId = useSyncExternalStore(
    userIdentity.listen,
    userIdentity.get,
    () => null
  );
  const authDialog = useAuthDialog();
  const submit = userId ? (
    <>
      <Button
        onPress={() => {
          const comment = inputRef.current?.value;
          if (!comment) {
            return;
          }
          signWithIdentity(userId, {content: comment});
        }}
      >
        Comment as {`${userId.username}@${displaySiteUrl}`}
      </Button>
      <Button
        onPress={() => {
          setUserIdentity(null);
        }}
      >
        Log out
      </Button>
    </>
  ) : (
    <>
      <Button
        onPress={() => {
          const comment = inputRef.current?.value;
          if (!comment) {
            return;
          }
          authDialog.open({challenge: {content: comment}});
        }}
      >
        Authenticate with {displaySiteUrl}
      </Button>
    </>
  );
  return (
    <YStack gap="$2">
      <Input ref={inputRef} placeholder="Write a comment..." />
      {submit}
      {authDialog.content}
    </YStack>
  );
}
