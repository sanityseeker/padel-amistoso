import type { MantineColorsTuple } from '@mantine/core';

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

const court: MantineColorsTuple = [
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
];
const success: MantineColorsTuple = [
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
];
const warning: MantineColorsTuple = [
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
];
const danger: MantineColorsTuple = [
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
];
const tennis: MantineColorsTuple = [
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
];
const stadium: MantineColorsTuple = [
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
];

// Optic ball yellow-green: the single signal color ("live", "your turn"). Index 4 is the dark-scheme
// fill and 5 the light-scheme fill; 9 is the readable ink on light surfaces.
const ball: MantineColorsTuple = [
  '#f9fcdf',
  '#f1f9b8',
  '#e8f58a',
  '#dff564',
  '#d8f550',
  '#d6f23a',
  '#bcd62a',
  '#98ad20',
  '#6f8018',
  '#4a6b00',
];

export const gray: MantineColorsTuple = [
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
];
export const darkRamp: MantineColorsTuple = [
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
];

// `ink` is the neutral text-colored pill (in progress): the css-variable resolver gives it a tint of the
// body text color, so it reads the same in light and dark and borrows no sport hue.
export const palette = { court, tennis, stadium, success, warning, danger, ball, ink: gray };
