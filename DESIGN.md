# WebLLM Design System

Lightweight tokens for the extension popup (400×520px fixed panel).

## Principles

- **Monochrome first** — neutral grays + one accent (near-black `#111827`)
- **Status is always visible** — header pill shows runtime state
- **States are explicit** — loading bar, empty state, warnings, typing scaffold
- **No fake persistence** — onboarding explains what caches vs what is ephemeral

## Color

| Token | Value | Use |
|-------|-------|-----|
| `--color-bg` | `#f3f4f6` | Page background |
| `--color-surface` | `#ffffff` | Cards, composer |
| `--color-text` | `#111827` | Primary text |
| `--color-muted` | `#6b7280` | Secondary text |
| `--color-border` | `#e5e7eb` | Dividers |
| `--color-accent` | `#111827` | User bubbles, primary button |
| `--color-success` | `#166534` on `#dcfce7` | WebGPU status |
| `--color-warn` | `#92400e` on `#fef3c7` | CPU / warnings |
| `--color-error` | `#991b1b` on `#fee2e2` | Error status |
| `--color-info` | `#1d4ed8` on `#dbeafe` | Loading / warming |

## Typography

- Stack: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
- Title: 16px / 700
- Body: 13px / 1.45
- Meta: 11–12px

## Spacing & touch

- Minimum tap target: **44×44px** (send/stop button)
- Panel padding: **12–14px**
- Message gap: **10px**

## Components

| Component | States |
|-----------|--------|
| Status pill | warming, webgpu, cpu, refreshing, error |
| Model progress | hidden, 0–100% width bar |
| Empty state | visible until first user message |
| Onboarding card | dismissible (session only) |
| Chat bubbles | user, assistant, system, typing |
| Composer | idle, busy (disabled input + stop) |

## Accessibility

- Landmarks: `banner`, `log`, `application`
- Live regions: status (`polite`), warnings (`alert`)
- `prefers-reduced-motion`: disable toggle/progress transitions
- Focus: visible outline on interactive elements
