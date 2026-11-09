import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Chip,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail } from '../../types';
import { EmptyState, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import {
  canonical,
  eligibleOf,
  emptyEntry,
  toConditions,
  toDraft,
  type FilterDraft,
  type FilterDraftEntry,
} from './filter';

// The final participant filter: conditions on the sign-up answers decide who may take part. Conditions
// are AND-ed; the preview updates as you edit, Save stores it (PATCH participant_filter) and Clear
// removes it (PATCH clear_participant_filter). A saved filter preselects people when you convert.
export function ParticipantFilter({ lobby }: { lobby: LobbyDetail }) {
  useLocale();
  const [draft, setDraft] = useState<FilterDraft>(() => toDraft(lobby.participant_filter));
  const conditions = useMemo(() => toConditions(draft, lobby.questions), [draft, lobby.questions]);
  const eligible = useMemo(
    () => eligibleOf(lobby.registrants, conditions, lobby.questions),
    [lobby.registrants, lobby.questions, conditions],
  );
  const dirty = canonical(conditions) !== canonical(lobby.participant_filter);
  const refresh = [
    ['admin', 'lobby', lobby.id],
    ['admin', 'lobbies'],
  ];
  const save = useAdminMutation({
    request: () =>
      write(
        `/registrations/${lobby.id}`,
        conditions.length ? { participant_filter: conditions } : { clear_participant_filter: true },
        'PATCH',
      ),
    invalidate: refresh,
    success: 'Filter saved',
  });
  const clear = useAdminMutation({
    request: () => write(`/registrations/${lobby.id}`, { clear_participant_filter: true }, 'PATCH'),
    invalidate: refresh,
    success: 'Filter cleared',
    onSuccess: () => setDraft({}),
  });
  const entry = (key: string) => draft[key] ?? emptyEntry();
  const change = (key: string, patch: Partial<FilterDraftEntry>) =>
    setDraft((cur) => ({ ...cur, [key]: { ...(cur[key] ?? emptyEntry()), ...patch } }));

  if (!lobby.questions.length)
    return (
      <EmptyState title={tx('No questions to filter on')}>
        {tx('Add questions to the sign-up form in the lobby settings, then filter by the answers.')}
      </EmptyState>
    );
  return (
    <Stack gap="md" data-testid="participant-filter">
      <Text c="dimmed" size="sm">
        {tx(
          'Pick conditions on the answers to decide who can take part. All conditions must match. A saved filter preselects the eligible people when you convert the lobby.',
        )}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        {lobby.questions.map((q) => {
          const e = entry(q.key);
          return (
            <Paper key={q.key} p="md" variant="row">
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text fw={650}>{q.label}</Text>
                  <Switch
                    size="sm"
                    label={tx('Require an answer')}
                    checked={e.answered}
                    onChange={(ev) => change(q.key, { answered: ev.currentTarget.checked })}
                  />
                </Group>
                {(q.type === 'choice' || q.type === 'multichoice') && (
                  <>
                    <Chip.Group
                      multiple
                      value={e.values}
                      onChange={(values) => change(q.key, { values })}
                    >
                      <Group gap={6}>
                        {q.choices.map((c) => (
                          <Chip key={c} value={c} size="sm">
                            {c}
                          </Chip>
                        ))}
                      </Group>
                    </Chip.Group>
                    <Text size="xs" c="dimmed">
                      {tx('Anyone who picked one of the selected choices matches.')}
                    </Text>
                  </>
                )}
                {q.type === 'number' && (
                  <Group grow gap="xs">
                    <NumberInput
                      aria-label={`${q.label}: ${tx('Minimum')}`}
                      placeholder={tx('Minimum')}
                      decimalScale={4}
                      value={e.min}
                      onChange={(v) => change(q.key, { min: v === '' ? '' : String(v) })}
                    />
                    <NumberInput
                      aria-label={`${q.label}: ${tx('Maximum')}`}
                      placeholder={tx('Maximum')}
                      decimalScale={4}
                      value={e.max}
                      onChange={(v) => change(q.key, { max: v === '' ? '' : String(v) })}
                    />
                  </Group>
                )}
                {q.type === 'text' && (
                  <TextInput
                    aria-label={`${q.label}: ${tx('Contains')}`}
                    placeholder={tx('Answer contains…')}
                    maxLength={256}
                    value={e.text}
                    onChange={(ev) => change(q.key, { text: ev.currentTarget.value })}
                  />
                )}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
      <Paper p="md" variant="row" aria-live="polite" data-testid="filter-result">
        {conditions.length === 0 ? (
          <Text size="sm" c="dimmed">
            {tx('No conditions: everyone who signed up can take part.')}
          </Text>
        ) : (
          <Stack gap="xs">
            <Text size="sm">
              {tx('Matching')}:{' '}
              <b>
                {eligible.length} / {lobby.registrants.length}
              </b>
            </Text>
            {eligible.length ? (
              <Group gap={6}>
                {eligible.map((r) => (
                  <Badge key={r.player_id} variant="light" color="court" size="lg" tt="none">
                    {r.player_name}
                  </Badge>
                ))}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                {tx('Nobody matches these conditions.')}
              </Text>
            )}
          </Stack>
        )}
      </Paper>
      <MutationError error={save.error ?? clear.error} />
      <Group justify="flex-end" gap="sm">
        {dirty && <Badge color="yellow">{tx('Unsaved changes')}</Badge>}
        <Button
          variant="default"
          loading={clear.isPending}
          disabled={!lobby.participant_filter?.length && !conditions.length}
          onClick={() => clear.mutate()}
        >
          {tx('Clear filter')}
        </Button>
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          {tx('Save filter')}
        </Button>
      </Group>
    </Stack>
  );
}
