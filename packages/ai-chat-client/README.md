# @pointerdevks/ai-chat-client
Official JavaScript client for PointerAI chat APIs.

## Install
```bash
# after publishing
npm install @pointerdevks/ai-chat-client

# local development (from monorepo root)
npm install ./packages/ai-chat-client
```

## Quick Start
```ts
import { createPointerAIClient, createAnonUid } from '@pointerdevks/ai-chat-client';

const client = createPointerAIClient({
  baseUrl: 'https://pointerdev.ai',
  projectId: '<PROJECT_ID>',
  publishableKey: '<PUBLISHABLE_KEY>',
});

const anonUid = createAnonUid();
const session = await client.createSession({ anonUid });

const result = await client.chat({
  message: 'Hello',
  sessionUid: session.uid,
  anonUid,
  metadata: { source: 'npm-client' },
});

console.log(result);
```

## login_required Projects
```ts
client.setEndUserToken('<END_USER_JWT>');

// Exchange once for short-lived runtime session token
await client.exchangeSessionToken();

const result = await client.chat({
  message: 'Hello as end-user',
  metadata: { source: 'secured-flow' },
});
```

### Runtime Session Token Flow (recommended)
```ts
// 1) Set end-user token from your backend
client.setEndUserToken('<END_USER_JWT>');

// 2) Exchange to runtime session token
const sessionAuth = await client.exchangeSessionToken();
console.log(sessionAuth.expires_at);

// 3) Use chat normally (client prefers session token automatically)
const response = await client.chat({ message: 'Hello' });

// 4) Optional explicit refresh/revoke
await client.refreshSessionToken();
await client.revokeSessionToken();
```

## API Methods
- `createSession({ anonUid?, metadata?, endUserToken? })`
- `listSessionsByAnon(anonUid, { limit?, endUserToken? })`
- `listSessionsByUser({ limit?, endUserToken? })`
- `listMessages(sessionUid, { limit?, endUserToken? })`
- `chat({ message, sessionUid?, anonUid?, metadata?, endUserToken? })`
- `exchangeSessionToken({ endUserToken?, sessionId? })`
- `refreshSessionToken({ token?, persist? })`
- `revokeSessionToken({ token?, clearSession? })`
- `setSessionToken(token, meta?)`
- `clearSessionToken()`
- `getSessionTokenState()`
- `setEndUserToken(token)`
- `clearEndUserToken()`

## Publish
```bash
cd packages/ai-chat-client
npm publish --access public
```


