# Telegram Typing Indicator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Telegram's native "typing…" indicator from the moment a message is received until the bot's reply is sent.

**Architecture:** Inside `TelegramService.onMessage`, start a `setInterval` that calls `ctx.api.sendChatAction(chatId, 'typing')` every 4 seconds (below Telegram's 5-second expiry), send one immediate call before the interval starts so the indicator appears without delay, then clear the interval in a `finally` block after `agentRunner.run` resolves or throws.

**Tech Stack:** TypeScript, grammY (`Bot`, `Context` from `grammy`)

---

## Chunk 1: Add typing indicator to `TelegramService.onMessage`

### Task 1: Update `src/services/telegram.ts`

**Files:**
- Modify: `src/services/telegram.ts`

No new files. No interface changes. No other files touched.

- [ ] **Step 1: Send an immediate typing action before `agentRunner.run`**

In `src/services/telegram.ts`, inside `onMessage`, add the following immediately before the `try` block that calls `agentRunner.run` (after the session lazy-creation block):

```ts
const chatId = ctx.chat!.id

// Show typing indicator immediately
void ctx.api.sendChatAction(chatId, 'typing').catch(() => { /* ignore */ })

// Keep typing indicator alive for the full duration of the agent run
const typingInterval = setInterval(() => {
    void ctx.api.sendChatAction(chatId, 'typing').catch(() => { /* ignore */ })
}, 4000)
```

The `ctx.chat` is guaranteed non-null at this point because the message passed authorization checks (an authorized message always has a chat).

- [ ] **Step 2: Clear the interval in the `finally` block**

Wrap the existing `try/catch` in a `try/catch/finally`. The existing `try` block already handles the `agentRunner.run` call and error reply. Add a `finally` clause:

The full updated `try/catch/finally` block should look like:

```ts
try {
    const response = await this.agentRunner.run(this.session, text)
    const assistantTurn: ConversationTurn = {role: 'assistant', content: response, timestamp: Date.now()}
    await this.memory.appendToDaily(assistantTurn)
    if (response) await ctx.reply(response, {parse_mode: 'Markdown'})
} catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await ctx.reply(`Error: ${msg}`)
} finally {
    clearInterval(typingInterval)
}
```

- [ ] **Step 3: Run build to verify no type errors**

```bash
npm run build
```

Expected: clean build, zero errors.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: zero warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/telegram.ts
git commit -m "feat: show typing indicator in Telegram while agent is running"
```

- [ ] **Step 6: Copy build artifact to vault**

```bash
cp main.js "/Users/showwaiyan/Library/Mobile Documents/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/lava-claw/main.js"
```

Then in Obsidian: disable and re-enable the plugin. Send a message via Telegram and verify the typing indicator appears immediately and stays visible until the reply arrives.
