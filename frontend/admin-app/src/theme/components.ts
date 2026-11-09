import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  Menu,
  Modal,
  Overlay,
  Paper,
  Popover,
  SegmentedControl,
  Table,
  Tabs,
  Text,
  Title,
  Combobox,
  type MantineThemeComponents,
} from '@mantine/core';
import classes from './components.module.css';

const camel = (value: string) => value.replace(/-(\w)/g, (_, ch: string) => ch.toUpperCase());
const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');
const variantClass = (prefix: string, variant: string | undefined) =>
  variant && variant !== 'default'
    ? (classes as Record<string, string>)[camel(prefix ? `${prefix}-${variant}` : variant)]
    : undefined;

// Component defaults, variants and sizes. Variants are looked up by name in components.module.css:
// <Paper variant="row" | "court-panel" | "dashed">, <Text variant="eyebrow" | "score" | "score-xl" | "mono">.
export const components: MantineThemeComponents = {
  Button: Button.extend({ defaultProps: { fw: 600 } }),
  ActionIcon: ActionIcon.extend({ defaultProps: { variant: 'subtle', color: 'gray' } }),
  Badge: Badge.extend({ defaultProps: { tt: 'none', radius: 'xl', fw: 600 } }),
  // Surfaces are bordered but flat; only floating layers cast a shadow.
  Paper: Paper.extend({
    defaultProps: { withBorder: true, radius: 'lg', shadow: undefined },
    classNames: (_theme, props) => ({
      root: cx(classes.paper, variantClass('paper', props.variant)),
    }),
  }),
  Card: Card.extend({
    defaultProps: { withBorder: true, radius: 'lg' },
    classNames: { root: classes.paper },
  }),
  Modal: Modal.extend({
    defaultProps: { radius: 'lg' },
    classNames: { content: classes.surface, header: classes.surface, overlay: classes.overlay },
  }),
  Drawer: Drawer.extend({
    classNames: { content: classes.surface, header: classes.surface, overlay: classes.overlay },
  }),
  Overlay: Overlay.extend({ classNames: { root: classes.overlay } }),
  Popover: Popover.extend({ classNames: { dropdown: classes.surface } }),
  Menu: Menu.extend({ classNames: { dropdown: classes.surface } }),
  Combobox: Combobox.extend({ classNames: { dropdown: classes.surface } }),
  Input: Input.extend({ classNames: { input: classes.input } }),
  SegmentedControl: SegmentedControl.extend({
    classNames: { root: classes.segmentedRoot, indicator: classes.segmentedIndicator },
  }),
  Table: Table.extend({
    classNames: { table: classes.table, thead: classes.thead, th: classes.th },
  }),
  Tabs: Tabs.extend({ classNames: { tab: classes.tab, list: classes.tabList } }),
  Title: Title.extend({
    classNames: (_theme, props) => ({
      root: cx(classes.title, (classes as Record<string, string>)[`h${props.order ?? 1}`]),
    }),
  }),
  Text: Text.extend({
    classNames: (_theme, props) => ({ root: variantClass('', props.variant) }),
  }),
};
