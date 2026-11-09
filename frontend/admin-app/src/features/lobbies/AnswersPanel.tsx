import { useState } from 'react';
import {
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail, Question } from '../../types';
import { EmptyState } from '../../ui';
import { registrantAnswer } from './filter';

const cell = (value: string) => (/[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

function download(lobby: LobbyDetail) {
  const header = [tx('Name'), ...lobby.questions.map((q) => q.label)].map(cell).join(',');
  const rows = lobby.registrants.map((r) =>
    [r.player_name, ...lobby.questions.map((q) => registrantAnswer(r.answers?.[q.key], q))]
      .map(cell)
      .join(','),
  );
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `answers_${(lobby.name || lobby.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const LONG = 100;
const DICTIONARY_AT = 25;

/** The choices a registrant picked for one question (a multi-choice answer is a JSON list). */
function picked(raw: string | undefined, q: Question): string[] {
  if (!raw) return [];
  return q.type === 'multichoice' ? registrantAnswer(raw, q).split(', ').filter(Boolean) : [raw];
}

// One question: who answered, a bar per choice (tap a bar to list only the people who chose it), the range
// of numbers, and every individual answer. Long choices get letters with a legend so the bars stay readable.
function QuestionCard({
  lobby,
  q,
  people,
}: {
  lobby: LobbyDetail;
  q: Question;
  people: LobbyDetail['registrants'];
}) {
  useLocale();
  const [hideEmpty, setHideEmpty] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [sortByAnswer, setSortByAnswer] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [find, setFind] = useState('');
  const total = lobby.registrants.length;
  const choiceType = (q.type === 'choice' || q.type === 'multichoice') && q.choices.length > 0;
  const counts = new Map(q.choices.map((c) => [c, 0]));
  for (const r of lobby.registrants)
    for (const p of picked(r.answers?.[q.key], q)) counts.set(p, (counts.get(p) ?? 0) + 1);
  const letters = q.choices.some((c) => c.length > DICTIONARY_AT);
  const letter = (c: string) => String.fromCharCode(65 + q.choices.indexOf(c));
  const answered = lobby.registrants.filter((r) => r.answers?.[q.key]).length;
  const nums = lobby.registrants
    .map((r) => parseFloat(r.answers?.[q.key] ?? ''))
    .filter((n) => !Number.isNaN(n));
  let rows = people.filter(
    (r) =>
      (!hideEmpty || r.answers?.[q.key]) &&
      (!choice || picked(r.answers?.[q.key], q).includes(choice)),
  );
  if (find.trim())
    rows = rows.filter((r) => r.player_name.toLowerCase().includes(find.trim().toLowerCase()));
  if (sortByAnswer)
    rows = [...rows].sort((a, b) =>
      registrantAnswer(a.answers?.[q.key], q).localeCompare(
        registrantAnswer(b.answers?.[q.key], q),
      ),
    );
  const list = (
    <Stack gap={4} data-testid="answer-list">
      {rows.map((r) => {
        const raw = r.answers?.[q.key] ?? '';
        const text = registrantAnswer(raw, q);
        const long = !choiceType && text.length > LONG;
        const isOpen = expanded.includes(r.player_id);
        const shown = !text
          ? '—'
          : choiceType && letters
            ? picked(raw, q).map(letter).join(', ')
            : long && !isOpen
              ? text.slice(0, LONG) + '…'
              : text;
        return (
          <Group key={r.player_id} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="sm" fw={600} w={120} style={{ flexShrink: 0 }}>
              {r.player_name}
            </Text>
            {long ? (
              <UnstyledButton
                onClick={() =>
                  setExpanded((cur) =>
                    isOpen ? cur.filter((x) => x !== r.player_id) : [...cur, r.player_id],
                  )
                }
                title={tx('Click to expand')}
              >
                <Text size="sm">{shown}</Text>
              </UnstyledButton>
            ) : (
              <Text size="sm" c={text ? undefined : 'dimmed'}>
                {shown}
              </Text>
            )}
          </Group>
        );
      })}
      {!rows.length && (
        <Text size="sm" c="dimmed">
          {tx('No participants match this search.')}
        </Text>
      )}
    </Stack>
  );
  return (
    <Paper p="md" variant="row">
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
          <Text fw={650}>{q.label}</Text>
          <Group gap={4} wrap="nowrap">
            {q.type !== 'text' && (
              <Badge size="xs" variant="light" color="gray">
                {tx(
                  q.type === 'multichoice'
                    ? 'Multiple choice'
                    : q.type === 'number'
                      ? 'Number'
                      : 'Choice',
                )}
              </Badge>
            )}
            {q.required && (
              <Badge size="xs" variant="light">
                {tx('Required')}
              </Badge>
            )}
            {!choiceType && (
              <Badge size="xs" variant="outline" color="gray">
                {answered} / {total}
              </Badge>
            )}
          </Group>
        </Group>
        {letters && (
          <Stack gap={0}>
            {q.choices.map((c) => (
              <Text key={c} size="xs" c="dimmed">
                <b>{letter(c)}</b> {c}
              </Text>
            ))}
          </Stack>
        )}
        {choiceType && (
          <Stack gap={6}>
            {q.choices.map((c) => {
              const n = counts.get(c) ?? 0;
              return (
                <UnstyledButton
                  key={c}
                  title={tx('Click to filter by this option')}
                  onClick={() => {
                    setChoice(choice === c ? null : c);
                    setOpen(true);
                  }}
                  aria-pressed={choice === c}
                >
                  <Group justify="space-between" gap="xs">
                    <Text size="sm" fw={choice === c ? 700 : 400}>
                      {letters ? letter(c) : c}
                    </Text>
                    <Text size="sm" fw={600}>
                      {n}
                    </Text>
                  </Group>
                  <Progress
                    value={total ? (n / total) * 100 : 0}
                    aria-label={`${c}: ${n}`}
                    size="sm"
                    color={choice === c ? 'court' : 'gray'}
                  />
                </UnstyledButton>
              );
            })}
          </Stack>
        )}
        {q.type === 'number' && nums.length > 0 && (
          <Text size="sm">
            {tx('Min')} <b>{Math.min(...nums)}</b> · {tx('Average')}{' '}
            <b>{(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)}</b> · {tx('Max')}{' '}
            <b>{Math.max(...nums)}</b>
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {tx('{n} without an answer', { n: total - answered })}
        </Text>
        {total - answered > 0 && (
          <Switch
            size="xs"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.currentTarget.checked)}
            label={tx('Hide unanswered')}
          />
        )}
        {choiceType ? (
          <>
            <Group gap="xs">
              <Button variant="subtle" size="compact-sm" onClick={() => setOpen((o) => !o)}>
                {open ? tx('Hide individual answers') : tx('Show individual answers')} (
                {rows.length})
              </Button>
              {open && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => setSortByAnswer((v) => !v)}
                >
                  {sortByAnswer ? tx('Sort by registration order') : tx('Sort by answer')}
                </Button>
              )}
              {choice && (
                <Button variant="subtle" size="compact-sm" onClick={() => setChoice(null)}>
                  {tx('Clear filter')}
                </Button>
              )}
            </Group>
            <Collapse expanded={open}>{list}</Collapse>
          </>
        ) : (
          <>
            {people.length > 4 && (
              <TextInput
                size="xs"
                placeholder={tx('Search by name')}
                aria-label={tx('Search by name')}
                value={find}
                onChange={(e) => setFind(e.currentTarget.value)}
              />
            )}
            {list}
          </>
        )}
      </Stack>
    </Paper>
  );
}

// How the sign-up questions were answered: a card per question with a bar per choice, the range of
// numbers and every individual answer, a participant filter, and a CSV of everything to open in a spreadsheet.
export function AnswersPanel({ lobby }: { lobby: LobbyDetail }) {
  useLocale();
  const [name, setName] = useState('');
  const [who, setWho] = useState<string | null>(null);
  if (!lobby.questions.length)
    return (
      <EmptyState title={tx('No questions to summarise')}>
        {tx('Add questions to the sign-up form in the lobby settings.')}
      </EmptyState>
    );
  const people = lobby.registrants.filter(
    (r) =>
      (!who || r.player_name === who) &&
      (!name.trim() || r.player_name.toLowerCase().includes(name.trim().toLowerCase())),
  );
  return (
    <Stack gap="md" data-testid="answers-panel">
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="xs">
          <TextInput
            label={tx('Participant')}
            placeholder={tx('Search by name')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Select
            aria-label={tx('Participant')}
            placeholder={tx('All participants')}
            clearable
            searchable
            data={lobby.registrants.map((r) => r.player_name)}
            value={who}
            onChange={setWho}
          />
        </Group>
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          onClick={() => download(lobby)}
        >
          {tx('Download answers (CSV)')}
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {lobby.questions.map((q) => (
          <QuestionCard key={q.key} lobby={lobby} q={q} people={people} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}
