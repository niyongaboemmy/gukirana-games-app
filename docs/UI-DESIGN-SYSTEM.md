# UI design system (2D overlay)

Dark gaming UI: graphite glass surfaces, one blue accent used sparingly, gold for Stars. Single source:
`apps/web/app/globals.css` (`@theme` tokens + classes in `@layer components`, so any Tailwind utility on the same
element still wins). Use these instead of hex values in classNames. The 3D scene (world/**, hall interiors) keeps its
own material colours; game identity colours (Pool / Ludo / Igisoro) stay as data.

## Typography

| Token | Face | Use |
| --- | --- | --- |
| `--font-display` (`font-display`) | **Chakra Petch** 500/600/700 | titles (h1-h3), chips, buttons, tiles, keycaps, `label`, `num` |
| `--font-ui` (`font-sans`, default) | **Inter** (variable) | body: chat, menus, descriptions, inputs |

Why: Chakra Petch has the squared, technical "HUD" character of Rajdhani/Orbitron but keeps open apertures and a
normal width, so it stays legible at 11-14 px on a phone in landscape (Rajdhani is too thin and narrow at that size,
Orbitron is titles-only, Oxanium/Exo 2 are close seconds). Inter is the most legible UI face at small sizes. Both
ship `latin-ext` (all Kinyarwanda / French / English letters and diacritics). Loaded with `next/font/google` in
`app/layout.tsx`: self-hosted at build time, no runtime CDN. Licences: SIL Open Font License 1.1 (see
`docs/ASSET-LICENSES.md`).

## Colour tokens (Tailwind: `bg-*`, `text-*`, `border-*`, `ring-*`)

| Token | Value | Use |
| --- | --- | --- |
| `ink-950` | `#0B0D10` | near-black base (page backdrops, keycap shadow) |
| `ink-900` / `ink-800` / `ink-700` / `ink-600` / `ink-500` | `#121418` `#16191F` `#1C2027` `#232832` `#2C323D` | graphite surfaces, raised to highest |
| `primary` (`primary-500`) | `#3B82F6` | the accent: primary buttons, active tabs, selection, progress |
| `primary-600` / `primary-700` | `#2563EB` / `#1D4ED8` | gradient bottom / pressed |
| `accent`, `ring` (`primary-400`) | `#60A5FA` | focus rings, selected outlines, accent edge lines |
| `gold`, `star` | `#FBBF24` | Stars, level, XP, Quick Match bolt, challenge |
| `success` / `success-soft` / `success-ink` | `#22C55E` / `#86EFAC` / `#052E16` | accept, online, talking |
| `warning` / `warning-soft` | `#F59E0B` / `#FCD34D` | timers running out, notices |
| `danger` / `danger-soft` | `#EF4444` / `#FCA5A5` | decline, block, report, unread badges |
| `on-glass` / `on-glass-muted` | `#F3F4F6` / `#D1D5DB` at 78% | text on glass |

Glass (CSS variables on `:root`): `--glass-1` graphite `rgb(22 25 31 / .74)` + 6% top sheen; `--glass-2`
`rgb(18 20 24 / .84)`; solid fallbacks at 94-97%; edge `white / 9%`, top edge `white / 18%`; blur 18 / 22 px
(10 / 12 px on touch), saturate 140%. Radii: `rounded-card` 14 px, `rounded-control` 10 px, sheets 16 px, chips
full. Shadows: `shadow-float`, `shadow-elevated`, `shadow-glow` (subtle accent).

## Surfaces and components

| Class | What |
| --- | --- |
| `glass` | glass-1: graphite frost, crisp 1 px edge with brighter top, soft deep shadow. HUD chips, pills, prompts. |
| `glass-elevated` | glass-2: darker and more opaque, bigger shadow. Menus, chat. |
| `glass-solid` | the same look without blur (nested surfaces, static backdrops). |
| `sheet` | glass-2 + a thin accent line on the top edge: dialogs, the seat sheet, person menu, settings, match sheets. |
| `menu`, `menu-item` | popover surface + rows (hover / press tint). |
| `chip`, `toast` | glass-1 pill (display face); `chip` buttons get hover + press. |
| `icon-button` | glass-1 button, centred content; keep your own size + radius classes. |
| `controller`, `controller-active` | controller-style round action buttons (inner light, rim); active = accent rim + soft glow. |
| `btn-primary` | the accent button. `btn-secondary` (translucent, inset hairline), `btn-danger`, `btn-success`. |
| `tile`, `tile-active` | option tiles inside a surface (emotes, person actions); active = accent outline + glow. |
| `label` | uppercase small caps section title (display face, 0.12em tracking). |
| `num` | display face, bold tabular figures (Stars, levels, timers). |
| `kbd` | keycap hint (E / T / V) on desktop. |
| `scrim` | modal backdrop (no blur, on purpose). |
| `press` | 160 ms transitions + scale 0.97 on press (no scale with reduced motion). |
| `scene-text` | text shadow for captions drawn straight on the 3D scene. |

Focus: every button, link, input and tab gets a 2 px `ring` outline on `:focus-visible` (base layer).

## Performance rules

- Blur only the floating element itself; never nest a blurred surface inside another (inner parts use `tile`,
  `btn-secondary` or `glass-solid`). Modal scrims use `scrim` (no full-screen blur over WebGL).
- Touch devices use a lighter blur. The Lite tier (`html[data-glass="lite"]`, set by `useGlassTier()` in
  `src/ui/glass.ts`, same heuristic as the 3D tier, `?tier=lite` to test), browsers without `backdrop-filter`, and
  `prefers-reduced-transparency` get the solid surfaces with no blur.
- Transitions are 150-200 ms on colour / scale only; `prefers-reduced-motion` drops the scale.
