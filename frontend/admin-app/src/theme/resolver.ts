import type { CSSVariablesResolver } from '@mantine/core';
import { legacyColors } from './palette';
import { roleTokens, sharedTokens } from './tokens';

function themeCssTokens(mode: keyof typeof legacyColors) {
  const c = legacyColors[mode];
  const shade = mode === 'light' ? 'oklch(0.2 0.02 240 / ' : 'oklch(0.05 0.03 240 / ';
  const alpha = mode === 'light' ? [0.08, 0.12, 0.16, 0.2] : [0.5, 0.6, 0.7, 0.65];
  return {
    '--color-bg': c.bg,
    '--color-surface': c.surface,
    '--color-surface-2': c.surface2,
    '--color-surface-offset': c.offset,
    '--color-divider': c.divider,
    '--color-border': c.border,
    '--color-text': c.text,
    '--color-text-muted': c.muted,
    '--color-text-faint': c.faint,
    '--color-primary': c.primary,
    '--color-primary-hover': c.primaryHover,
    '--color-primary-active': c.primaryActive,
    '--color-primary-highlight': `color-mix(in srgb, ${c.primary} ${mode === 'light' ? '11%' : '14%'}, transparent)`,
    '--color-on-primary': '#ffffff',
    '--color-success': c.success,
    '--color-on-success': '#ffffff',
    '--color-warning': c.warning,
    '--color-warning-text': c.warningText,
    '--color-error': c.error,
    '--color-yellow': c.gold,
    '--color-sport-tennis': c.tennis,
    '--color-sport-padel': c.primary,
    '--color-on-tennis': mode === 'light' ? '#ffffff' : '#0d1520',
    '--shadow-sm': `0 1px 3px ${shade}${alpha[0]})`,
    '--shadow-md': `0 4px 12px ${shade}${alpha[1]})`,
    '--shadow-lg': `0 12px 32px ${shade}${alpha[2]})`,
    '--shadow-overlay': `0 8px 24px ${shade}${alpha[3]})`,
  };
}

function schemeVariables(mode: keyof typeof legacyColors) {
  const c = legacyColors[mode];
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(c))
    vars[
      `--app-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`).replace(/([a-z])(\d)/g, '$1-$2')}`
    ] = value;
  const role = roleTokens[mode];
  return {
    ...vars,
    ...themeCssTokens(mode),
    ...role,
    '--app-primary-light': `color-mix(in srgb, ${c.primary} ${mode === 'light' ? '11%' : '14%'}, transparent)`,
    '--app-shadow': `0 8px 24px color-mix(in srgb, ${legacyColors.dark.bg} ${mode === 'light' ? '8%' : '45%'}, transparent)`,
    '--app-court-line': role['--color-court-line'],
    '--mantine-color-body': c.bg,
    '--mantine-color-text': c.text,
    '--mantine-color-bright': c.text,
    '--mantine-color-dimmed': c.muted,
    '--mantine-color-placeholder': c.faint,
    '--mantine-color-anchor': c.primary,
    '--mantine-color-default': c.surface,
    '--mantine-color-default-hover': c.surface2,
    '--mantine-color-default-color': c.text,
    '--mantine-color-default-border': c.border,
    '--mantine-color-disabled': c.surface2,
    '--mantine-color-disabled-color': c.faint,
    '--mantine-color-disabled-border': c.border,
    '--mantine-color-error': c.error,
    '--mantine-color-success': c.success,
    '--mantine-color-court-filled': c.primary,
    '--mantine-color-court-filled-hover': c.primaryHover,
    '--mantine-color-court-light': `var(--app-primary-light)`,
    '--mantine-color-court-light-hover': c.active,
    '--mantine-color-court-light-color': c.primary,
    '--mantine-color-court-outline': c.primary,
    '--mantine-color-court-outline-hover': c.hover,
    // `color="ball"` on Indicator, Badge, Progress: fill is the ball, text on the surface is the ink.
    '--mantine-color-ball-filled': role['--color-ball'],
    '--mantine-color-ball-filled-hover': mode === 'light' ? '#c4e02c' : '#c9e63f',
    '--mantine-color-ball-light': `color-mix(in srgb, ${role['--color-ball']} ${mode === 'light' ? '30%' : '16%'}, transparent)`,
    '--mantine-color-ball-light-hover': `color-mix(in srgb, ${role['--color-ball']} ${mode === 'light' ? '42%' : '24%'}, transparent)`,
    '--mantine-color-ball-light-color': role['--color-ball-ink'],
    '--mantine-color-ball-outline': role['--color-ball-ink'],
    '--mantine-color-ball-outline-hover': `color-mix(in srgb, ${role['--color-ball']} 18%, transparent)`,
    '--mantine-color-ball-text': role['--color-ball-ink'],
    // `color="ink"`: the "in progress" pill. A tint of the body text color with the text color itself on
    // top, so it is a legible light pill in both schemes (no solid gray, no dark on dark).
    '--mantine-color-ink-filled': c.text,
    '--mantine-color-ink-filled-hover': c.text,
    '--mantine-color-ink-light': `color-mix(in srgb, ${c.text} ${mode === 'light' ? '9%' : '16%'}, transparent)`,
    '--mantine-color-ink-light-hover': `color-mix(in srgb, ${c.text} ${mode === 'light' ? '14%' : '22%'}, transparent)`,
    '--mantine-color-ink-light-color': c.text,
    '--mantine-color-ink-outline': c.text,
    '--mantine-color-ink-outline-hover': `color-mix(in srgb, ${c.text} 8%, transparent)`,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    ...sharedTokens,
    '--app-hero-bg': legacyColors.dark.surface,
    '--app-hero-text': legacyColors.dark.text,
    '--app-hero-muted': legacyColors.dark.muted,
    '--app-ball': legacyColors.dark.tennis,
    '--app-on-ball': legacyColors.light.text,
  },
  light: schemeVariables('light'),
  dark: schemeVariables('dark'),
});
