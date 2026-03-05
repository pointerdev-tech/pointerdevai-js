# @pointerdev/pointerai-widget

Embeddable PointerAI chat widget for script-tag/CDN integration.

This package now ships a real source/build pipeline and uses `@pointerdev/pointerai-client` under the hood.

## Install via CDN (after publish)

```html
<script src="https://cdn.jsdelivr.net/npm/@pointerdev/pointerai-widget@latest/dist/pointerai-widget.js" defer></script>
```

## Local development

```bash
cd packages/pointerai-widget
npm install
npm run lint
npm run build
npm run smoke
```

## Quick start

```html
<script>
window.pointeraiWidgetConfig = {
  apiBaseUrl: 'https://api.example.com',
  projectId: '<PROJECT_ID>',
  publishableKey: '<PUBLISHABLE_KEY>',
  title: 'Support chat',
  launcherLabel: 'Chat with us',
};
</script>
<script src="https://cdn.jsdelivr.net/npm/@pointerdev/pointerai-widget@latest/dist/pointerai-widget.js" defer></script>
```

## login_required projects

Provide `endUserToken` from your backend so the widget can exchange it for a short-lived runtime session token:

```html
<script>
window.pointeraiWidgetConfig = {
  apiBaseUrl: 'https://api.example.com',
  projectId: '<PROJECT_ID>',
  publishableKey: '<PUBLISHABLE_KEY>',
  endUserToken: '<END_USER_JWT>',
};
</script>
<script src="https://cdn.jsdelivr.net/npm/@pointerdev/pointerai-widget@latest/dist/pointerai-widget.js" defer></script>
```

## Options

- `apiBaseUrl` (required)
- `projectId` (required)
- `publishableKey` (required)
- `endUserToken` (required for login_required projects)
- `getEndUserToken` (optional async token provider for login_required projects)
- `anonUid`
- `metadata`
- `title`
- `subtitle`
- `launcherLabel`
- `launcherIcon`
- `launcherIconUrl`
- `logoUrl`
- `welcomeMessage`
- `placeholder`
- `sendLabel`
- `themeColor`
- `panelBackgroundColor`
- `messagesBackgroundColor`
- `textColor`
- `mutedTextColor`
- `panelBorderColor`
- `assistantBubbleColor`
- `assistantTextColor`
- `userBubbleColor`
- `userTextColor`
- `fontFamily`
- `borderRadius`
- `zIndex`
- `position` (`right` / `left`)
- `sideOffset`
- `bottomOffset`
- `width`
- `maxHeight`
- `openOnLoad`
- `historyFetchLimit` (default `100`, max `200`)

## Manual init

```html
<script>
(async function () {
  await window.PointerAIWidget.init({
    apiBaseUrl: 'https://api.example.com',
    projectId: '<PROJECT_ID>',
    publishableKey: '<PUBLISHABLE_KEY>',
  });
})();
</script>
```

## Runtime controls

```html
<script>
window.PointerAIWidget.open();
window.PointerAIWidget.close();
await window.PointerAIWidget.sendMessage('Hello from host page');
await window.PointerAIWidget.setEndUserToken('<FRESH_END_USER_JWT>');
await window.PointerAIWidget.reconnect();
</script>
```

## Runtime behavior

- Guest mode:
  - creates/persists `anonUid` in `localStorage`
  - creates a chat session and reuses persisted `sessionUid`
- Login-required mode:
  - exchanges `endUserToken` via `/api/runtime/sessions`
  - silently refreshes runtime tokens in background when eligible
- Chat history:
  - stores message history in `localStorage` per project
  - on mount, fetches backend `listMessages` and replaces local cache with server truth
- UX:
  - typing indicator while answer is in progress
  - offline/online awareness with reconnect status
  - one-click retry for the last failed message
