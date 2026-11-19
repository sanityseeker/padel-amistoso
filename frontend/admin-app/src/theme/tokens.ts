import { baseColors } from './palette';

export const fontStacks = {
  display: "'Geologica', 'Onest', system-ui, sans-serif",
  body: "'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace",
} as const;

// Scheme-independent tokens.
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
  '--ai-size-score': 'max(48px, 3.125rem)',
  // The spectator screen ("tv" size): close to the Player Hub's type on a laptop (body 1rem, section
  // titles like an h2, the event name like an h1), growing gently with the viewport so a hall TV
  // stays readable, and stopping at a ceiling so a 4K display is not oversized.
  '--fs-tv-sm': 'clamp(0.8125rem, 0.2vw + 0.6rem, 1.25rem)',
  '--fs-tv-md': 'clamp(1rem, 0.3vw + 0.7rem, 1.5rem)',
  '--fs-tv-lg': 'clamp(1.125rem, 0.4vw + 0.8rem, 1.875rem)',
  '--fs-tv-xl': 'clamp(1.25rem, 0.6vw + 0.85rem, 2.5rem)',
  '--fs-tv-display': 'clamp(1.75rem, 1vw + 1.1rem, 3.5rem)',
  '--button-height-tv': 'clamp(44px, 2.2vw, 64px)',
  '--button-padding-x-tv': 'clamp(1rem, 0.8vw, 1.75rem)',
  '--button-fz-tv': 'var(--fs-tv-md)',
  // Mantine reads a component's font size from this name, whatever the size key.
  '--mantine-font-size-tv': 'var(--fs-tv-md)',
  '--ai-size-tv': 'clamp(44px, 2vw, 60px)',
  // Motion: three durations, one easing.
  '--motion-fast': '120ms',
  '--motion-base': '180ms',
  '--motion-slow': '240ms',
  '--motion-ease': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

// Role tokens added by the "Baseline" design. They sit next to the base palette and never replace it.
// Optic ball yellow-green is the single signal color: "live" or "your turn", never decoration.
export const roleTokens = {
  light: {
    '--color-ball': '#d6f23a',
    '--color-on-ball': '#0d1520',
    '--color-ball-ink': '#4a6b00',
    '--color-focus': baseColors.light.primary,
    '--color-nav-ink': baseColors.light.muted,
    '--color-nav-ink-active': baseColors.light.text,
    '--color-court-panel': '#0f3a66',
    '--color-court-line': 'rgba(255, 255, 255, 0.28)',
    '--color-rank-1': '#b89000',
    '--color-rank-2': '#7d8b99',
    '--color-rank-3': '#a4622c',
    // Text on the bronze place mark: white on the darker light-mode bronze, ink on the lighter dark one.
    '--color-on-rank-3': '#ffffff',
    '--color-status-await': baseColors.light.warning,
    '--color-status-dispute': baseColors.light.error,
  },
  dark: {
    '--color-ball': '#d8f550',
    '--color-on-ball': '#07101c',
    '--color-ball-ink': '#d8f550',
    '--color-focus': '#d8f550',
    '--color-nav-ink': baseColors.dark.muted,
    '--color-nav-ink-active': baseColors.dark.text,
    '--color-court-panel': '#0b2440',
    '--color-court-line': 'rgba(142, 166, 190, 0.35)',
    '--color-rank-1': '#d4a800',
    '--color-rank-2': '#9aa7b5',
    '--color-rank-3': '#c27a3e',
    '--color-on-rank-3': '#07101c',
    '--color-status-await': baseColors.dark.warning,
    '--color-status-dispute': baseColors.dark.error,
  },
} as const;
