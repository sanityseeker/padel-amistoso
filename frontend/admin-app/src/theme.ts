import {
  createTheme,
  localStorageColorSchemeManager,
  type CSSVariablesResolver,
} from '@mantine/core';

// Source: frontend/theme.css — "Hardcourt Nights", day court / night session.
// Keep semantic values here; components and CSS consume tokens, not hex colors.
export const legacyColors = {
  light: {
    bg: '#eff2f6',
    surface: '#fafbfc',
    surface2: '#e5eaf2',
    offset: '#dce3ee',
    border: '#bfc9d8',
    divider: 'rgba(148, 168, 192, 0.45)',
    text: '#0d1520',
    muted: '#4a5a6e',
    faint: '#8496a8',
    primary: '#1a5fa3',
    primaryHover: '#155090',
    primaryActive: '#10406f',
    success: '#2a7a40',
    warning: '#c87800',
    warningText: '#6b3e00',
    error: '#c0301e',
    tennis: '#4a8c00',
    gold: '#b89000',
    hover: 'rgba(26, 95, 163, 0.05)',
    active: 'rgba(26, 95, 163, 0.10)',
    overlay: 'rgba(13, 21, 32, 0.55)',
  },
  dark: {
    bg: '#07101c',
    surface: '#0e1c2e',
    surface2: '#152438',
    offset: '#091424',
    border: '#1c2e44',
    divider: 'rgba(28, 46, 68, 0.8)',
    text: '#e4ecf5',
    muted: '#8ea6be',
    faint: '#506070',
    primary: '#2e8ad4',
    primaryHover: '#2577bb',
    primaryActive: '#1c62a0',
    success: '#22c55e',
    warning: '#d48000',
    warningText: '#fbbf24',
    error: '#ef4444',
    tennis: '#9abb00',
    gold: '#d4a800',
    hover: 'rgba(46, 138, 212, 0.07)',
    active: 'rgba(46, 138, 212, 0.14)',
    overlay: 'rgba(0, 8, 18, 0.75)',
  },
} as const;

const court = [
  '#edf5fc',
  '#d9eafb',
  '#b2d2f0',
  '#79b4e6',
  '#2e8ad4',
  '#2577bb',
  '#1a5fa3',
  '#155090',
  '#10406f',
  '#0c2e51',
] as const;
const success = [
  '#edf8ef',
  '#d3efdc',
  '#a9dfbc',
  '#70d394',
  '#22c55e',
  '#278e48',
  '#2a7a40',
  '#216735',
  '#18532a',
  '#113e1e',
] as const;
const warning = [
  '#fff6e6',
  '#ffebc6',
  '#ffda99',
  '#efb75d',
  '#d48000',
  '#cc7c00',
  '#c87800',
  '#a65e00',
  '#814800',
  '#6b3e00',
] as const;
const danger = [
  '#fff0ec',
  '#ffddd5',
  '#ffb8ab',
  '#fa8473',
  '#ef4444',
  '#d83a28',
  '#c0301e',
  '#a9281a',
  '#872218',
  '#651a13',
] as const;
const tennis = [
  '#f4f8e5',
  '#e7efc3',
  '#d4e38d',
  '#bdd65a',
  '#9abb00',
  '#70a500',
  '#4a8c00',
  '#3e7500',
  '#305c00',
  '#234400',
] as const;
const stadium = [
  '#fff9df',
  '#fff0b3',
  '#f5dd70',
  '#e8c738',
  '#d4a800',
  '#c69d00',
  '#b89000',
  '#967400',
  '#745a00',
  '#544100',
] as const;

export const theme = createTheme({
  primaryColor: 'court',
  primaryShade: { light: 6, dark: 4 },
  autoContrast: true,
  luminanceThreshold: 0.18,
  black: legacyColors.light.text,
  white: '#ffffff',
  colors: {
    court,
    tennis,
    stadium,
    success,
    warning,
    danger,
    // Built-in semantic names used by Mantine's errors/notifications stay in
    // the same design system as explicitly named application colors.
    blue: court,
    green: success,
    teal: success,
    orange: warning,
    yellow: stadium,
    red: danger,
    gray: [
      '#fafbfc',
      '#eff2f6',
      '#e5eaf2',
      '#dce3ee',
      '#bfc9d8',
      '#8496a8',
      '#4a5a6e',
      '#33445a',
      '#1c2e44',
      '#0d1520',
    ],
    dark: [
      '#e4ecf5',
      '#8ea6be',
      '#506070',
      '#334a64',
      '#243b54',
      '#1c2e44',
      '#152438',
      '#0e1c2e',
      '#091424',
      '#07101c',
    ],
  },
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
  headings: { fontFamily: 'inherit', fontWeight: '650' },
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { fw: 600 } },
    Paper: { defaultProps: { withBorder: true } },
  },
});

function schemeVariables(mode: keyof typeof legacyColors) {
  const c = legacyColors[mode];
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(c))
    vars[
      `--app-${key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`).replace(/([a-z])(\d)/g, '$1-$2')}`
    ] = value;
  return {
    ...vars,
    '--app-primary-light': `color-mix(in srgb, ${c.primary} ${mode === 'light' ? '11%' : '14%'}, transparent)`,
    '--app-shadow': `0 8px 24px color-mix(in srgb, ${legacyColors.dark.bg} ${mode === 'light' ? '8%' : '45%'}, transparent)`,
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
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--app-hero-bg': legacyColors.dark.surface,
    '--app-hero-text': legacyColors.dark.text,
    '--app-hero-muted': legacyColors.dark.muted,
    '--app-ball': legacyColors.dark.tennis,
    '--app-on-ball': legacyColors.light.text,
    '--app-court-line': 'rgba(142, 166, 190, 0.45)',
  },
  light: schemeVariables('light'),
  dark: schemeVariables('dark'),
});

// Reuse the legacy preference and migrate its older key. The toggle writes only
// light/dark, which the original pages understand; an unset key follows the OS.
try {
  const old = localStorage.getItem('padel-theme');
  if (!localStorage.getItem('amistoso-theme') && (old === 'light' || old === 'dark')) {
    localStorage.setItem('amistoso-theme', old);
    localStorage.removeItem('padel-theme');
  }
} catch {
  /* Browsers without storage still support the current session theme. */
}
export const colorSchemeManager = localStorageColorSchemeManager({ key: 'amistoso-theme' });
