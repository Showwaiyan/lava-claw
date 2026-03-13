# Sleep Prevention Feature Design

**Date:** 2026-03-13
**Status:** Approved

## Goal

Allow users to prevent macOS from sleeping while the plugin is running, so the Telegram bot stays responsive when the laptop lid is closed (with power connected). Controlled via a toggle in settings. No effect on Windows or Linux (future work).

---

## Architecture

A new `SleepPreventionService` class in `src/services/sleep-prevention.ts` implements the existing `Service` interface (`init` / `destroy`). It is registered and managed by `PluginCore` alongside all other services. A new `preventSleep: boolean` field is added to `LavaClawSettings` (default `false`).

---

## Components

### `src/services/sleep-prevention.ts` (new file)

- Implements `Service` (`init`, `destroy`)
- `readonly id = 'sleep-prevention'`
- `init()`:
  - If `settings.preventSleep === false` → return immediately (no-op)
  - If `platform() !== 'darwin'` → return immediately (no-op, no Notice)
  - Otherwise: `spawn('caffeinate', ['-i'])`, store the `ChildProcess` reference
- `destroy()`:
  - If a child process is stored, call `.kill()` and clear the reference
- Uses `ChildProcess` from Node.js `child_process` (available because `isDesktopOnly: true`)
- No UI, no settings knowledge beyond the single boolean

### `src/settings.ts`

- Add `preventSleep: boolean` to `LavaClawSettings` interface
- Add `preventSleep: false` to `DEFAULT_SETTINGS`
- Add a new "General" heading at the top of `LavaClawSettingTab.display()`, before the existing "AI provider" heading
- Add one toggle under it:
  - Name: `Prevent system sleep`
  - Desc: `Keep macOS awake while the plugin is running. Has no effect on Windows or Linux.`
  - On change: save settings, call `this.plugin.core.restartService('sleep-prevention')`

### `src/core.ts`

- Import `SleepPreventionService`
- In `init()`: construct `SleepPreventionService`, `registerService` it, `await` its `init()`, assign to `this.sleepPrevention`
- Add `sleepPrevention!: SleepPreventionService` public field (consistent with other service fields)
- No other changes — `destroy()` and `restartService()` already handle all registered services generically

---

## Data Flow

```
User toggles setting ON
  → settings.preventSleep = true
  → saveSettings()
  → core.restartService('sleep-prevention')
    → SleepPreventionService.destroy()  (kills any existing caffeinate)
    → SleepPreventionService.init()     (spawns caffeinate -i on macOS)

User toggles setting OFF
  → settings.preventSleep = false
  → saveSettings()
  → core.restartService('sleep-prevention')
    → SleepPreventionService.destroy()  (kills caffeinate immediately)
    → SleepPreventionService.init()     (sees false, returns no-op)

Obsidian closes
  → onunload() → core.destroy()
    → SleepPreventionService.destroy()  (kills caffeinate if running)
```

---

## Error Handling

- `spawn` failures (e.g. `caffeinate` not found — unlikely on macOS): catch and show a `Notice('Lava Claw: Failed to prevent sleep.')`
- `.kill()` errors: silently ignored (process may already be dead)

---

## Files Changed

| File | Change |
|---|---|
| `src/services/sleep-prevention.ts` | **New** — `SleepPreventionService` |
| `src/settings.ts` | Add `preventSleep` field + toggle in settings UI |
| `src/core.ts` | Register and expose `SleepPreventionService` |

No changes to `types.ts`, `main.ts`, or any other file.

---

## Out of Scope

- Windows (`SetThreadExecutionState`) and Linux (`systemd-inhibit`) support — future work
- Any UI indicator showing sleep prevention is active — not requested
