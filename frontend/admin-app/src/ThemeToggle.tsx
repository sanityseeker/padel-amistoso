import { useEffect } from 'react';
import {
  ActionIcon,
  Group,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { legacyColors } from './theme';
import { LanguageSelect } from './LanguageSelect';
import { t as tx, useLocale } from './i18n';
export function ThemeSync() {
  const scheme = useComputedColorScheme('light');
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', legacyColors[scheme].bg);
  }, [scheme]);
  return null;
}
export function ThemeToggle() {
  useLocale();
  const scheme = useComputedColorScheme('light');
  const { setColorScheme } = useMantineColorScheme();
  const label = tx(scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  return (
    <Group gap={2} wrap="nowrap">
      <LanguageSelect />
      <Tooltip label={label} floatingStrategy="fixed">
        <ActionIcon
          variant="subtle"
          color="court"
          size="lg"
          aria-label={label}
          onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
        >
          {scheme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
