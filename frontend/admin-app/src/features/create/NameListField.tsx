import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Input,
  SegmentedControl,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';

const split = (value: string) =>
  value
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

interface Row {
  id: number;
  value: string;
}

// A list of names kept as one text value (one per line), edited either as plain text or as a form
// with one input per name. Both views read and write the same string, so switching loses nothing.
export function NameListField({
  label,
  description,
  placeholder,
  value,
  onChange,
  itemLabel,
  removeLabel,
  addLabel,
  itemPlaceholder,
  minRows = 3,
  required = true,
  hideLabel = false,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of a row input, given its 1-based position. */
  itemLabel: (n: number) => string;
  removeLabel: (n: number) => string;
  addLabel: string;
  itemPlaceholder: (n: number) => string;
  minRows?: number;
  required?: boolean;
  /** The surrounding block already names the list (a settings Section title); keep only the switch. */
  hideLabel?: boolean;
}) {
  useLocale();
  const [view, setView] = useState<'text' | 'form'>('form');
  const next = useRef(0);
  const make = (names: string[]): Row[] =>
    (names.length ? names : ['']).map((v) => ({ id: next.current++, value: v }));
  const [rows, setRows] = useState<Row[]>(() => make(split(value)));

  // Names added from outside the form (the known-players picker) show up as new rows.
  useEffect(() => {
    if (view !== 'form') return;
    if (
      split(value).join('\n') !==
      rows
        .map((r) => r.value.trim())
        .filter(Boolean)
        .join('\n')
    )
      setRows(make(split(value)));
    // biome-ignore lint/correctness/useExhaustiveDependencies: only react to the value and view
  }, [value, view]);

  const commit = (list: Row[]) => {
    setRows(list);
    onChange(
      list
        .map((r) => r.value.trim())
        .filter(Boolean)
        .join('\n'),
    );
  };
  const switchTo = (v: string) => {
    if (v === 'form') setRows(make(split(value)));
    setView(v as 'text' | 'form');
  };

  return (
    <Stack gap="xs">
      <Group justify={hideLabel ? 'flex-end' : 'space-between'} align="flex-end" wrap="nowrap">
        {!hideLabel && <Input.Label required={required}>{label}</Input.Label>}
        <SegmentedControl
          size="xs"
          aria-label={tx('Input mode')}
          value={view}
          onChange={switchTo}
          data={[
            { value: 'text', label: tx('Text') },
            { value: 'form', label: tx('List') },
          ]}
        />
      </Group>
      {description && <Input.Description>{description}</Input.Description>}
      {view === 'text' ? (
        <Textarea
          aria-label={label}
          placeholder={placeholder}
          autosize
          minRows={minRows}
          required={required}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      ) : (
        <Stack gap="xs">
          {rows.map((row, i) => (
            <Group key={row.id} gap="xs" wrap="nowrap">
              <TextInput
                flex={1}
                aria-label={itemLabel(i + 1)}
                placeholder={itemPlaceholder(i + 1)}
                value={row.value}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  commit(rows.map((r) => (r.id === row.id ? { ...r, value: v } : r)));
                }}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={removeLabel(i + 1)}
                disabled={rows.length <= 1 && !row.value}
                onClick={() => {
                  const rest = rows.filter((r) => r.id !== row.id);
                  commit(rest.length ? rest : make([]));
                }}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
          ))}
          <div>
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => setRows([...rows, ...make([])])}
            >
              {addLabel}
            </Button>
          </div>
        </Stack>
      )}
    </Stack>
  );
}
