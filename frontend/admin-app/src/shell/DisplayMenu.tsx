import {
  ActionIcon,
  Button,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
  useMantineColorScheme,
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconDeviceDesktop,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import {
  LANGUAGES,
  type Language,
  SELECTABLE,
  currentLanguage,
  setLanguage,
  t as tx,
  useLocale,
} from '../i18n';
import { type UiScale, setUiScale, useUiScale } from '../theme/uiScale';

export function useDisplayLabels() {
  useLocale();
  const { colorScheme } = useMantineColorScheme();
  const theme = tx(colorScheme === 'auto' ? 'Auto' : colorScheme === 'dark' ? 'Dark' : 'Light');
  const language = LANGUAGES.find((entry) => entry.code === currentLanguage())!;
  return { long: `${language.name} · ${theme}`, short: language.short };
}

// A choice that shows a short visible mark and keeps the full name for screen readers and tests.
function Choice({ mark, name, tip }: { mark: React.ReactNode; name: string; tip?: boolean }) {
  const inner = (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span aria-hidden>{mark}</span>
      <VisuallyHidden>{name}</VisuallyHidden>
    </span>
  );
  return tip ? (
    <Tooltip label={name} openDelay={300}>
      {inner}
    </Tooltip>
  ) : (
    inner
  );
}

// Language (EN / ES / RU, from SELECTABLE), theme (auto, light, dark) and interface size as small segmented
// controls, about 200 px wide. Theme "Auto" follows the OS and is stored as an absent amistoso-theme key.
// Used in the header popover, and in the phone More menu sheet.
export function DisplayPanel({ maxWidth = 220 }: { maxWidth?: number | string }) {
  useLocale();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const uiScale = useUiScale();
  return (
    <Stack gap="sm" w="100%" maw={maxWidth} data-testid="display-panel">
      <div>
        <Text size="xs" fw={700} c="dimmed" mb={4}>
          {tx('Language')}
        </Text>
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label={tx('Language')}
          value={currentLanguage()}
          onChange={(value) => void setLanguage(value as Language)}
          data={LANGUAGES.filter((entry) => SELECTABLE.includes(entry.code)).map((entry) => ({
            value: entry.code,
            label: <Choice mark={entry.short} name={entry.name} />,
          }))}
        />
      </div>
      <div>
        <Text size="xs" fw={700} c="dimmed" mb={4}>
          {tx('Theme')}
        </Text>
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label={tx('Theme')}
          value={colorScheme}
          onChange={(value) => setColorScheme(value as 'auto' | 'light' | 'dark')}
          data={[
            {
              value: 'auto',
              label: <Choice tip mark={<IconDeviceDesktop size={16} />} name={tx('Auto')} />,
            },
            {
              value: 'light',
              label: <Choice tip mark={<IconSun size={16} />} name={tx('Light')} />,
            },
            {
              value: 'dark',
              label: <Choice tip mark={<IconMoon size={16} />} name={tx('Dark')} />,
            },
          ]}
        />
      </div>
      <div>
        <Text size="xs" fw={700} c="dimmed" mb={4}>
          {tx('Size')}
        </Text>
        <SegmentedControl
          fullWidth
          size="sm"
          aria-label={tx('Size')}
          // Three whole words: the Russian ones only fit with tighter padding.
          styles={{ label: { paddingInline: 6 } }}
          value={uiScale}
          onChange={(value) => setUiScale(value as UiScale)}
          data={[
            { value: '85', label: tx('Small') },
            { value: '95', label: tx('Normal') },
            { value: '110', label: tx('Large') },
          ]}
        />
      </div>
    </Stack>
  );
}

// The header trigger: a sliders icon (44 px) when `compact`, otherwise the sliders and the language code.
// Not a gear: that already means Admin and tournament settings.
// The full value ("English · Auto") stays in the accessible name. It opens an anchored popover.
export function DisplayButton({ compact = false }: { compact?: boolean }) {
  const label = useDisplayLabels();
  const name = tx('Preferences: {value}', { value: label.long });
  return (
    <Popover position="bottom-end" width={256} shadow="md" withinPortal>
      <Popover.Target>
        {compact ? (
          <ActionIcon size="touch" style={{ flexShrink: 0 }} aria-label={name} title={label.long}>
            <IconAdjustmentsHorizontal size={20} />
          </ActionIcon>
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="compact-md"
            h="var(--tap-md)"
            leftSection={<IconAdjustmentsHorizontal size={17} />}
            aria-label={name}
            title={label.long}
          >
            {label.short}
          </Button>
        )}
      </Popover.Target>
      <Popover.Dropdown>
        <DisplayPanel />
      </Popover.Dropdown>
    </Popover>
  );
}
