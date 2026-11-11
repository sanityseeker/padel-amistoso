import { useState } from 'react';
import {
  Button,
  Collapse,
  Group,
  Indicator,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconChevronDown } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type {
  FormatOverride,
  InputFormat,
  Match,
  SetDecider,
  SetMatchFormatBody,
} from '../../types';
import { canScoreSets, type Ctx } from './scoring';
import { useSetFormat } from './useScoreActions';
import { Notice } from '../../ui/Notice';

type Replacement = Pick<SetMatchFormatBody, 'score1' | 'score2' | 'sets'>;

// Per-match scoring format (PATCH /matches/{mid}/format): input mode, third-set decider and, for
// Mexicano rounds, the points target. A change that alters what a stored score means needs a
// replacement score; the server says so with a 409 and the current form is sent along.
export function MatchFormat({
  tid,
  match,
  ctx,
  totalPoints,
  replacement,
  onApplied,
}: {
  tid: string;
  match: Match;
  ctx: Ctx;
  totalPoints: number;
  replacement: () => Replacement | null;
  onApplied: (override: FormatOverride | null) => void;
}) {
  useLocale();
  const set = useSetFormat(tid);
  const override = match.format_override;
  const [mode, setMode] = useState<InputFormat | 'default'>(override?.mode ?? 'default');
  const [decider, setDecider] = useState<SetDecider | 'default'>(override?.decider ?? 'default');
  const [target, setTarget] = useState<number | string>(
    override?.points_target ?? match.effective_points_target ?? totalPoints,
  );
  const [message, setMessage] = useState('');
  const [open, { toggle }] = useDisclosure(false);
  const mex = ctx === 'mex';

  const apply = async (reset: boolean) => {
    setMessage('');
    const next: Partial<FormatOverride> = reset
      ? {}
      : {
          mode: mode === 'default' || mex ? null : mode,
          decider: decider === 'default' || mex ? null : decider,
          points_target: mex && Number(target) !== totalPoints ? Number(target) : null,
        };
    const empty = !next.mode && !next.decider && !next.points_target;
    const body: SetMatchFormatBody = { override: empty ? null : next };
    try {
      try {
        await set.mutateAsync({ match, body });
      } catch (e) {
        const extra = replacement();
        if (!(e as Error).message.startsWith('Re-enter the score') || !extra) throw e;
        await set.mutateAsync({ match, body: { ...body, ...extra } });
      }
      if (reset) {
        setMode('default');
        setDecider('default');
      }
      onApplied(empty ? null : { mode: null, decider: null, points_target: null, ...next });
    } catch (e) {
      const text = (e as Error).message;
      setMessage(
        text.startsWith('Re-enter the score')
          ? tx('Enter the replacement score above, then apply the format again.')
          : tx(text),
      );
    }
  };

  return (
    <Stack gap={0}>
      <Button
        variant="subtle"
        size="touch"
        justify="space-between"
        fullWidth
        aria-expanded={open}
        rightSection={<IconChevronDown size={16} />}
        onClick={toggle}
      >
        <Indicator
          inline
          size={8}
          offset={-4}
          position="middle-end"
          color="yellow"
          disabled={!override}
        >
          {tx('Match format')}
        </Indicator>
      </Button>
      <Collapse expanded={open}>
        <Stack gap="sm" mt="sm">
          {!mex && canScoreSets(ctx) && (
            <>
              <Text size="xs" c="dimmed">
                {tx('Score entry')}
              </Text>
              <SegmentedControl
                fullWidth
                value={mode}
                onChange={(v) => setMode(v as InputFormat | 'default')}
                data={[
                  { value: 'default', label: tx('Tournament default') },
                  { value: 'points', label: tx('Points') },
                  { value: 'sets', label: tx('Sets') },
                ]}
              />
              <Text size="xs" c="dimmed">
                {tx('Deciding third set')}
              </Text>
              <SegmentedControl
                fullWidth
                value={decider}
                onChange={(v) => setDecider(v as SetDecider | 'default')}
                data={[
                  { value: 'default', label: tx('Tournament default') },
                  { value: 'full_set', label: tx('Full set') },
                  { value: 'match_tiebreak', label: tx('Match tie-break') },
                ]}
              />
            </>
          )}
          {mex && (
            <NumberInput
              label={tx('Points in this match')}
              inputMode="numeric"
              min={2}
              max={200}
              allowDecimal={false}
              value={target}
              onChange={setTarget}
              description={
                Number(target) !== totalPoints
                  ? tx('Standings scale this match to {n} points', { n: totalPoints })
                  : undefined
              }
            />
          )}
          {match.disputed && (
            <Text size="xs" c="dimmed">
              {tx('Resolve the dispute before changing the format')}
            </Text>
          )}
          {message && <Notice tone="danger">{message}</Notice>}
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              size="touch"
              disabled={!override}
              loading={set.isPending}
              onClick={() => void apply(true)}
            >
              {tx('Use tournament default')}
            </Button>
            <Button
              variant="light"
              size="touch"
              loading={set.isPending}
              onClick={() => void apply(false)}
            >
              {tx('Apply format')}
            </Button>
          </Group>
        </Stack>
      </Collapse>
    </Stack>
  );
}
