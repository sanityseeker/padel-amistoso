import { Button, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { t as tx, useLocale } from '../i18n';
import { Notice } from './Notice';

/** "Have an event code?": one form for the public events page and the club landing page. The pages
 *  keep their own lookup; this is the field, the button and the result line. */
export function EventCodeFinder({
  value,
  onChange,
  onSubmit,
  busy,
  status,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  /** A neutral progress or result line ("Looking up…", "No results found."). */
  status?: string;
  /** A failed lookup, shown as an alert. */
  error?: string;
}) {
  useLocale();
  return (
    <Paper
      p="md"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Stack gap="xs">
        <Title order={2} size="h3">
          {tx('Have an event code?')}
        </Title>
        <Group align="flex-end" wrap="nowrap">
          <TextInput
            flex={1}
            label={tx('Event ID or alias')}
            placeholder={tx('Event ID or alias')}
            leftSection={<IconSearch size={16} />}
            autoComplete="off"
            spellCheck={false}
            required
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
          <Button type="submit" loading={busy}>
            {tx('Find event')}
          </Button>
        </Group>
        {status && (
          <Text size="sm" c="dimmed" role="status">
            {status}
          </Text>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </Stack>
    </Paper>
  );
}
