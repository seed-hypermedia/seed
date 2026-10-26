---
name: Voice conversations
summary: Talk to Seed agents in the desktop app and on the web.
---

# Talk to an agent

Open an agent conversation in Seed desktop or web and select **Voice** above the composer. Allow microphone
access when prompted. Starting voice from a new chat creates its conversation automatically. The agent uses the same model, tools, memory, and conversation as typed messages. Your completed
utterances and the agent's replies appear in the conversation.

The call shows when the agent is listening, thinking, or speaking. You can interrupt its speech, mute your microphone
while continuing to listen, or end the call. Ending the call releases your microphone; work the agent already accepted
continues in the conversation. Leaving the conversation or switching accounts also ends the call.

If your browser blocks playback, select **Enable sound**. A temporary network interruption shows **Reconnecting**;
if the call ends, start a new one. Microphone errors appear beside the call controls with instructions to recover.

# Set up voice

Voice requires an agent server configured with LiveKit and a speech worker. The Voice control appears only on servers
that offer it. Web access needs HTTPS or localhost, and a secure website needs a secure LiveKit connection.

If the server does not supply speech credentials, open **Voice settings** beside the composer and add your Deepgram
and Cartesia API keys. These belong to your account on the server hosting this conversation. They are encrypted at rest
and never displayed again. Clearing a key restores the server's shared key when one is available. Desktop Settings →
Advanced → Voice manages the local server's keys; conversation settings also work with remote servers.

Speech is sent to the configured speech providers for transcription and synthesis. Live voice stores the conversation
text, not an audio recording. The model provider and tools follow the agent's existing configuration.

Desktop and web share this interface. Clipper and other voice clients use the same Seed service. A packaged desktop
client can connect to a hosted voice server; its bundled local agents binary does not include the speech-worker
runtime. See `agents/docs/voice.md` in the source repository for operator setup and validation.
