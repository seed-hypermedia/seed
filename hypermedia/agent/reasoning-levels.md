---
name: Reasoning levels
summary: A reasoning level says how much a model thinks before it answers, the levels a model accepts depend on its family, and the runtime corrects itself when a provider rejects one.
---
An [agent](../agent.md) has an optional **reasoning level**: how much its model thinks before it answers. It is set in the agent's Settings, next to the model. This page lists the levels each model family accepts, what happens when none is set, and how the runtime sends the level.

# The levels <!-- id:cAV_thkI -->

Levels are `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Providers gate levels per model generation, so the lists below were tested against live provider APIs instead of copied from provider docs: <!-- id:o0RRTzN9 -->

<!-- id:w2DBomCg -->
| family <!-- col:TbnFySPL --> | levels <!-- col:sraKZh6w --> | leaving it unset <!-- col:KEjviHEU --> <!-- id:fkOMp1v4 --> |
| --- | --- | --- |
| OpenAI gpt-5 / gpt-5-mini | minimal, low, medium, high | provider default (can't disable) <!-- id:G66u980h --> |
| OpenAI gpt-5.1 | low, medium, high | off (sends `effort: 'none'`) <!-- id:NLKtzFqk --> |
| OpenAI gpt-5.2+ (incl. 5.4, 5.6) | low, medium, high, xhigh | off (sends `effort: 'none'`) <!-- id:P_htn8ec --> |
| OpenAI gpt-6+ (e.g. gpt-6-astra) | low, medium, high, xhigh, max | provider default (rejects `none`, can't disable) <!-- id:WgwQFUTj --> |
| OpenAI o-series (o1/o3/o4) | low, medium, high | provider default <!-- id:IAXkw7dU --> |
| Anthropic claude-3-7 and later | minimal, low, medium, high | off <!-- id:moUuGMt9 --> |
| Google gemini-2.5+ | minimal, low, medium, high | off, except `-pro` (default) <!-- id:ZPj6RMRf --> |

`gpt-5-chat*` variants expose no reasoning control. Anything else returns null, including every OpenAI-compatible passthrough type, and the picker shows nothing for it. <!-- id:1zBT-TX_ -->

# How the level is sent

The level is stored on the agent's definition (`reasoningLevel`) and applied before each turn. For OpenAI, the stored level wins over anything the model library would send, because that library clamps levels for models its catalog does not know. With no level, the request sends `none` where the generation accepts it. Otherwise it leaves the effort out, so the provider default applies. <!-- id:n3rwsNjt -->

Two OpenAI rules follow from how its newer models behave:

  - A model is marked as reasoning when the agent selected a level, or when the model needs an explicit "no reasoning" value. OpenAI's newer chat models turn reasoning on by default and reject function tools unless it is explicitly disabled. <!-- id:Sc89-Xri -->
  - A reasoning OpenAI model is called through the Responses API. OpenAI's gpt-5.1 and later models reject function tools on chat completions unless reasoning is explicitly disabled, and reject tools entirely once an effort is set there. The Responses API is the supported path for tools plus reasoning. <!-- id:UKxLkNYj -->

Each message in the [log](./log.md) records the level the turn actually ran at, which for a model that cannot stop reasoning is the provider's default.

# When a provider rejects a level

The table is a starting guess, and the runtime corrects it. When a provider rejects the effort a run sent ("Unsupported value: 'none' is not supported with the 'gpt-6-astra' model. Supported values are: 'low', …"), the server records the accepted list for that model in memory and uses it on every later request. A rejected `none` is dropped in favor of the provider default, and a rejected level moves to the nearest accepted one. So a model newer than the table costs one failed turn and then runs. The list is kept in memory only, so it is learned again after a restart. <!-- id:a_HKwf5s -->

# See also

- [Model providers](./model-providers.md)
- [Delegation budgets](./delegation-budgets.md) for thoroughness, the other dial in an agent's Settings
- [Agents in the Seed app](./in-the-app.md)
- [Signed API](../build/signed-api.md)
