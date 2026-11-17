---
name: Sign in with ChatGPT
summary: An OpenAI provider can use a person's ChatGPT plan in place of an API key, through a sign-in that the operator must turn on and that the desktop app completes.
---
If you pay for a ChatGPT plan, an [agent](../agent.md) can use it. An OpenAI [model provider](./model-providers.md) can sign in with your ChatGPT plan in place of an API key. The provider record then has `authMode: 'subscription'`. This page says when the option is offered, what the sign-in does, how runs use it, and what happens when it expires. <!-- id:qXlToTAw -->

# When it is offered

The operator of the server must turn it on. The sign-in is offered only when the server sets `SEED_APPS_SUBSCRIPTION_AUTH`. At the end of the sign-in, OpenAI sends the browser to a localhost address. So the sign-in needs a client that can catch that redirect, which is the [desktop app](../software/desktop.md), or a user who pastes the redirect URL. The desktop app checks the server's health flag before it offers the option. <!-- id:BX2XRnyz -->

# The sign-in

The sign-in is OAuth with PKCE against `https://auth.openai.com/oauth/authorize` and `/oauth/token`, client id `app_EMoamEEZ73f0CkXaXp7hrann`, redirect `http://localhost:1455/auth/callback`, scope `openid profile email offline_access`. Only one sign-in per [account](../protocol/identity.md) runs at a time. The server accepts either a bare code or the full pasted redirect URL. The credentials are stored in one secret per account, named `<type>-subscription-oauth`, so signing in again replaces them. <!-- id:tSDG11fW -->

The actions are `StartProviderOAuth`, `SubmitProviderOAuthCode`, `GetProviderOAuthStatus` and `CancelProviderOAuth` in the [signed API](../build/signed-api.md).

# How runs use it

A subscription provider sends its requests to a different service: `https://chatgpt.com/backend-api` with the Codex responses API, not the OpenAI API. The credentials live in the encrypted secret. The server reads them again for each request. It refreshes an expired access token, one refresh at a time, and writes new tokens back to the encrypted secret for later runs. <!-- id:i17XC_-M -->

Every model on this path is a reasoning model; see [reasoning levels](./reasoning-levels.md). A model the catalog does not know gets a context window of 272000 tokens.

# The model list

Models come from the same ChatGPT backend endpoint the Codex command-line tool fills its picker from: `GET https://chatgpt.com/backend-api/codex/models?client_version=…` with the access token as bearer auth and the workspace id in `ChatGPT-Account-Id`. The backend has no public docs for this; the response is `{models: [{slug, display_name, visibility, priority, supported_reasoning_levels, context_window, …}]}`. Entries with `visibility: "hide"` (internal review models) are dropped and the rest keep `priority` order. <!-- id:Zlrkeuct -->

- `client_version` is required and gates what the backend returns (each entry has a `minimal_client_version`). The server looks up the latest published `@openai/codex` version from npm and caches it for six hours, with a fixed minimum. A failed lookup uses the last successful version or that minimum and retries after five minutes. The provider's **Refresh** button skips this cache. <!-- id:lU_L8GOQ -->
- When the network or the backend fails, the server uses a built-in copy of the list, so the agent form never gets an empty list. <!-- id:QszbxdcN -->
- A 401 from the endpoint marks the sign-in as needing a new login and fails the listing with the message quoted under When the sign-in expires. <!-- id:PRy_hkvO -->

# When the sign-in expires

Before a run starts, the server reads the access token and refreshes it if needed. If that fails, the provider is marked `needs-login` and the run fails with "Your OpenAI subscription sign-in has expired or was revoked. Open model provider settings and sign in with ChatGPT again." So the user sees this message, not an unexplained error in the middle of a reply. In the providers dialog, a provider whose sign-in expired shows a button to sign in again. <!-- id:JGWi-2ic -->

# See also

- [Model providers](./model-providers.md)
- [Agents in the Seed app](./in-the-app.md)
- [Security model](./security.md)
- [Environments](../operate/environments.md)
- [Signed API](../build/signed-api.md)
