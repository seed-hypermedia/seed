---
name: Reasoning levels
summary: A reasoning level says how much a model thinks before it answers, the levels a model accepts depend on its family, and the server corrects itself when a provider rejects one.
---
A **reasoning level** says how much a model thinks before it answers. A higher level gives more careful answers and takes more time and tokens. Each [agent](../agent.md) can have one. You set it in the agent's Settings, next to the model. This page lists the levels each model family accepts, what happens when you set none, and how the server sends the level.

# The levels <!-- id:cAV_thkI -->

The levels are `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Each provider allows different levels for each generation of its models. The lists below come from tests against the real provider APIs, not from provider documentation: <!-- id:o0RRTzN9 -->

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

`gpt-5-chat*` models have no reasoning control. Any other model has no reasoning control either, including every model of an OpenAI-compatible type such as `ollama` or `custom`. The picker shows nothing for it. <!-- id:1zBT-TX_ -->

# How the level is sent

The level is stored on the agent's definition (`reasoningLevel`), and the server applies it before each turn. For OpenAI, the stored level wins over what the model library would send, because that library lowers levels for models it does not know. With no level, the request sends `none` where the model generation accepts it. Otherwise it sends no effort, so the provider default applies. <!-- id:n3rwsNjt -->

Two OpenAI rules follow from how its newer models behave:

  - A model is marked as reasoning when the agent selected a level, or when the model needs an explicit "no reasoning" value. OpenAI's newer chat models turn reasoning on by default and reject function tools unless it is explicitly disabled. <!-- id:Sc89-Xri -->
  - A reasoning OpenAI model is called through the Responses API. OpenAI's gpt-5.1 and later models reject function tools on chat completions unless reasoning is explicitly disabled, and reject tools entirely once an effort is set there. The Responses API is the supported path for tools plus reasoning. <!-- id:UKxLkNYj -->

Each message in the [log](./log.md) records the level the turn really ran at. For a model that cannot stop reasoning, that is the provider's default.

# When a provider rejects a level

The table is a first guess, and the server corrects it. When a provider rejects the effort a run sent ("Unsupported value: 'none' is not supported with the 'gpt-6-astra' model. Supported values are: 'low', …"), the server records the accepted list for that model in memory and uses it on every later request. When `none` is rejected, the server uses the provider default. When a level is rejected, the server uses the nearest accepted one. So a model newer than the table costs one failed turn and then works. The list is kept in memory only, so the server learns it again after a restart. <!-- id:a_HKwf5s -->

# See also

- [Model providers](./model-providers.md)
- [Delegation budgets](./delegation-budgets.md) for thoroughness, the other dial in an agent's Settings
- [Agents in the Seed app](./in-the-app.md)
- [Signed API](../build/signed-api.md)
