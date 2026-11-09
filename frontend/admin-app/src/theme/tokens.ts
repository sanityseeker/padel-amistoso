import { legacyColors } from './palette';

export const fontStacks = {
  display: "'Geologica', 'Onest', system-ui, sans-serif",
  body: "'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace",
} as const;

// Scheme-independent tokens, named exactly like frontend/theme.css so legacy CSS
// (footer, chips, display button) can be pasted without renaming.
export const sharedTokens: Record<string, string> = {
  '--font-display': fontStacks.display,
  '--font-body': fontStacks.body,
  '--font-data': fontStacks.body,
  '--font-mono': fontStacks.mono,
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-5': '1.25rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-10': '2.5rem',
  '--space-12': '3rem',
  '--space-16': '4rem',
  '--space-1-5': '0.375rem',
  '--space-2-5': '0.625rem',
  '--space-3-5': '0.875rem',
  // Layout rhythm: page gutter grows with the viewport; sections breathe more than stacks.
  '--gutter': 'clamp(1rem, 0.5rem + 2vw, 2rem)',
  '--section-gap': 'clamp(2rem, 1.5rem + 2vw, 3rem)',
  '--stack-gap': '0.75rem',
  '--radius-sm': '0.125rem',
  '--radius-md': '0.25rem',
  '--radius-lg': '0.375rem',
  '--radius-xl': '0.625rem',
  '--radius-full': '9999px',
  '--radius-card': '0.75rem',
  '--radius-dialog': '0.75rem',
  '--tap-lg': '44px',
  '--tap-md': '40px',
  '--tap-sm': '36px',
  '--fs-xs': '0.75rem',
  '--fs-sm': '0.8rem',
  '--fs-md': '0.85rem',
  // Sizes for the custom "touch" size of Button / ActionIcon (read by Mantine through getSize()).
  '--button-height-touch': '44px',
  '--button-padding-x-touch': '1rem',
  '--button-fz-touch': '1rem',
  '--ai-size-touch': '44px',
  '--ai-size-score': '48px',
  // The spectator screen ("tv" size): type that reads from across a room. Each step grows with the
  // viewport, from a phone up to a 4K display, and stops at a ceiling so a 4K TV is not comically large.
  '--fs-tv-sm': 'clamp(0.875rem, 0.55vw + 0.45rem, 1.75rem)',
  '--fs-tv-md': 'clamp(1rem, 0.75vw + 0.55rem, 2.25rem)',
  '--fs-tv-lg': 'clamp(1.25rem, 1.1vw + 0.6rem, 3rem)',
  '--fs-tv-xl': 'clamp(1.5rem, 1.7vw + 0.6rem, 4.25rem)',
  '--fs-tv-display': 'clamp(2rem, 2.8vw + 0.6rem, 6.5rem)',
  '--button-height-tv': 'clamp(44px, 3vw, 88px)',
  '--button-padding-x-tv': 'clamp(1rem, 1.2vw, 2.5rem)',
  '--button-fz-tv': 'var(--fs-tv-md)',
  // Mantine reads a component's font size from this name, whatever the size key.
  '--mantine-font-size-tv': 'var(--fs-tv-md)',
  '--ai-size-tv': 'clamp(44px, 2.8vw, 80px)',
  // Motion: three durations, one easing.
  '--motion-fast': '120ms',
  '--motion-base': '180ms',
  '--motion-slow': '240ms',
  '--motion-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

// Role tokens added by the "Baseline" design. They sit next to the legacy palette and never replace it;
// frontend/theme.css carries the same values (e2e/theme.spec.ts checks both stay in sync).
// Optic ball yellow-green is the single signal color: "live" or "your turn", never decoration.
export const roleTokens = {
  light: {
    '--color-ball': '#d6f23a',
    '--color-on-ball': '#0d1520',
    '--color-ball-ink': '#4a6b00',
    '--color-focus': legacyColors.light.primary,
    '--color-nav-ink': legacyColors.light.muted,
    '--color-nav-ink-active': legacyColors.light.text,
    '--color-court-panel': '#0f3a66',
    '--color-court-line': 'rgba(255, 255, 255, 0.28)',
    '--color-rank-1': '#b89000',
    '--color-rank-2': '#7d8b99',
    '--color-rank-3': '#a4622c',
    '--color-status-await': legacyColors.light.warning,
    '--color-status-dispute': legacyColors.light.error,
  },
  dark: {
    '--color-ball': '#d8f550',
    '--color-on-ball': '#07101c',
    '--color-ball-ink': '#d8f550',
    '--color-focus': '#d8f550',
    '--color-nav-ink': legacyColors.dark.muted,
    '--color-nav-ink-active': legacyColors.dark.text,
    '--color-court-panel': '#0b2440',
    '--color-court-line': 'rgba(142, 166, 190, 0.35)',
    '--color-rank-1': '#d4a800',
    '--color-rank-2': '#9aa7b5',
    '--color-rank-3': '#c27a3e',
    '--color-status-await': legacyColors.dark.warning,
    '--color-status-dispute': legacyColors.dark.error,
  },
} as const;
