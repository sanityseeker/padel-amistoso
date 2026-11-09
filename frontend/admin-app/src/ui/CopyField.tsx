import { ActionIcon, CopyButton, Group, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { t as tx, useLocale } from '../i18n';

// A link or code with a one-tap copy button.
export function CopyField({ value, label }: { value: string; label?: string }) {
  useLocale();
  return (
    <Group gap="xs" wrap="nowrap">
      <Text ff="monospace" size="sm" truncate miw={0} flex={1} title={value}>
        {value}
      </Text>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? tx('Copied') : tx('Copy')}>
            <ActionIcon
              variant="subtle"
              onClick={copy}
              aria-label={`${tx('Copy')}${label ? `: ${label}` : ''}`}
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}
