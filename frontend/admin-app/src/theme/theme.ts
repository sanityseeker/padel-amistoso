import { createTheme, rem } from '@mantine/core';
import { components } from './components';
import classes from './components.module.css';
import { darkRamp, gray, legacyColors, palette } from './palette';
import { fontStacks } from './tokens';

// Source palette: frontend/theme.css, "Hardcourt Nights". Role tokens (ball, rank, court-panel...) are
// added in tokens.ts and never replace a legacy value, so e2e/theme.spec.ts parity keeps passing.
export const theme = createTheme({
  primaryColor: 'court',
  primaryShade: { light: 6, dark: 4 },
  autoContrast: true,
  luminanceThreshold: 0.18,
  black: legacyColors.light.text,
  white: '#ffffff',
  colors: {
    ...palette,
    // Built-in semantic names used by Mantine's errors/notifications stay in
    // the same design system as explicitly named application colors.
    blue: palette.court,
    green: palette.success,
    teal: palette.success,
    orange: palette.warning,
    yellow: palette.stadium,
    red: palette.danger,
    gray,
    dark: darkRamp,
  },
  // Fonts are self-hosted (theme/fonts.css, imported by app/providers.tsx).
  fontFamily: fontStacks.body,
  fontFamilyMonospace: fontStacks.mono,
  // Fluid type scale (360 px to 1280 px). Body text is 16 px; nothing is below 12 px.
  fontSizes: {
    xs: rem(12),
    sm: rem(13),
    md: rem(16),
    lg: rem(18),
    xl: rem(20),
  },
  lineHeights: { xs: '1.2', sm: '1.4', md: '1.5', lg: '1.5', xl: '1.4' },
  headings: {
    fontFamily: fontStacks.display,
    fontWeight: '700',
    textWrap: 'balance',
    sizes: {
      h1: {
        fontSize: 'clamp(1.75rem, 1.4rem + 1.4vw, 2.25rem)',
        lineHeight: '1.05',
        fontWeight: '700',
      },
      h2: {
        fontSize: 'clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)',
        lineHeight: '1.15',
        fontWeight: '650',
      },
      h3: {
        fontSize: 'clamp(1.0625rem, 1rem + 0.2vw, 1.125rem)',
        lineHeight: '1.3',
        fontWeight: '650',
      },
      h4: { fontSize: rem(16), lineHeight: '1.35', fontWeight: '600' },
      h5: { fontSize: rem(14), lineHeight: '1.4', fontWeight: '600' },
      h6: { fontSize: rem(13), lineHeight: '1.4', fontWeight: '600' },
    },
  },
  // Controls 8 px, cards and sheets 12 px, pills full. Nothing else is rounder than 12 px.
  radius: { xs: '4px', sm: '8px', md: '10px', lg: '12px', xl: '9999px' },
  defaultRadius: 'sm',
  shadows: {
    xs: 'var(--shadow-sm)',
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)',
    xl: 'var(--shadow-overlay)',
  },
  focusRing: 'auto',
  focusClassName: classes.focus,
  respectReducedMotion: true,
  components,
});
