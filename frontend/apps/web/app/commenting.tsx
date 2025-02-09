import {decode as cborDecode, encode as cborEncode} from "@ipld/dag-cbor";
import {base58} from "@scure/base";
import {HMTimestamp, SITE_BASE_URL, UnpackedHypermediaId} from "@shm/shared";
import {useAppDialog} from "@shm/ui/src/universal-dialog";
import {Button} from "@tamagui/button";
import {Input} from "@tamagui/input";
import {Heading} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useRef, useState, useSyncExternalStore} from "react";
import {z} from "zod";
import type {
  CreateCommentPayload,
  HMUnsignedComment,
} from "./routes/hm.api.comment";

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
// const REQUESTING_PARTY_HOST = SITE_BASE_URL?.replace(/^https?:\/\//, "") // strip protocol
//   .replace(/\/$/, "");
const REQUESTING_PARTY_HOST = "localhost"; // for local development
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

  if (!REQUESTING_PARTY_HOST) {
    throw new Error("No REQUESTING_PARTY_HOST");
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
      id: REQUESTING_PARTY_HOST,
      name: `Site at ${REQUESTING_PARTY_HOST}`,
    },
    user: {
      id: userIdData,
      name: `${userId}@${REQUESTING_PARTY_HOST}`,
      displayName: displayName,
    },
    pubKeyCredParams: [
      // todo: review with @burdian
      {type: "public-key", alg: -7}, // ES256
      {type: "public-key", alg: -257}, // RS256
    ],
    timeout: 60000,
    attestation: "none",
    authenticatorSelection: {
      residentKey: "preferred",
    },
  };
  console.log("registering", {
    userId,
    displayName,
    REQUESTING_PARTY_HOST,
    publicKeyOptions,
  });

  try {
    const credential = await navigator.credentials.create({
      publicKey: publicKeyOptions,
    });
    console.log("creaetd credential", credential);
    if (!credential) {
      throw new Error("No credential");
    }
    const credId = base58.encode(new Uint8Array(credential.rawId));
    const authenticatorResponse: AuthenticatorResponse = credential.response;
    const clientDataJSON = new TextDecoder().decode(
      authenticatorResponse.clientDataJSON
    );
    // Decode the attestation object
    const attObj = cborDecode(
      new Uint8Array(authenticatorResponse.attestationObject)
    );
    // console.log("attObj", attObj);
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
  comment: HMUnsignedComment
) {
  const challengeData = cborEncode(comment);
  const userIdData = base58.decode(identity.credId);
  console.log("signWithIdentity", {
    comment,
    challengeData,
    userIdData,
    REQUESTING_PARTY_HOST,
    identity,
  });
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: challengeData,
    rpId: REQUESTING_PARTY_HOST,
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
    console.log("cred", cred);
    if (!cred) return null;
    if (cred.type !== "public-key") {
      throw new Error("Invalid credential type. Required public-key.");
    }
    const postData: CreateCommentPayload = {
      username: identity.username,
      hostname: REQUESTING_PARTY_HOST,
      response: {
        clientDataJSON: bufferToB58(cred.response.clientDataJSON), // this contains the challenge which is the encoded comment
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
  input: {comment: HMUnsignedComment};
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login" | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const userId = useSyncExternalStore(userIdentity.listen, userIdentity.get);
  if (userId) {
    return (
      <YStack gap="$2">
        <SizableText>
          Comment as "{userId?.username}@{REQUESTING_PARTY_HOST}"
        </SizableText>
        <Button
          onPress={() => {
            signWithIdentity(userId, input.comment).then((result) => {
              console.log("signWithIdentity result", result);
              onClose();
            });
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
        <Heading>Authenticate on {REQUESTING_PARTY_HOST}</Heading>
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
          onPress={() => {
            const username = usernameRef.current?.value;
            if (!username) return;
            registerPasskey({
              challenge: {junk: true}, // do we need a real challenge for auth creation? only if server wants to limit account creation?
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

function generateTimetamp(): HMTimestamp {
  const now = new Date();
  return {
    seconds: BigInt(Math.floor(now.getTime() / 1000)),
    nanos: (now.getTime() % 1000) * 1000000,
  };
}

function createComment(text: string): HMUnsignedComment {
  return {
    content: [
      {
        block: {
          type: "Paragraph",
          text,
          attributes: {},
          annotations: [],
          id: "0",
        },
      },
    ],
    createTime: generateTimetamp(),
  };
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
          const commentText = inputRef.current?.value;
          if (!commentText) {
            return;
          }
          signWithIdentity(userId, createComment(commentText));
        }}
      >
        Comment as {`${userId.username}@${REQUESTING_PARTY_HOST}`}
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
          const commentText = inputRef.current?.value;
          if (!commentText) {
            return;
          }
          authDialog.open({comment: createComment(commentText)});
        }}
      >
        Authenticate with {REQUESTING_PARTY_HOST}
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
