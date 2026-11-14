import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, NavLink, Popover, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconSettings } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { InputFormat, Score, SetDecider } from '../../types';
import { FormActions, ScoreStepper } from '../../ui';
import {
  formatKeyOf,
  formatSets,
  isTiebreakSet,
  parseSets,
  validatePoints,
  validateSets,
  type FormatKey,
  type ScoreError,
  type ScorePayload,
  type SetRow,
} from '../../admin/tournament/scoring';
import classes from './ScoreEntry.module.css';
import { Notice } from '../../ui/Notice';

export interface ScoreRules {
  /** Input modes this match accepts (Mexicano rounds are points only). */
  modes: InputFormat[];
  /** The stage default; entering another mode shows `formatNotice`. */
  defaultMode: InputFormat;
  /** Points must add up to this (0 = no rule). */
  total: number;
  decider: SetDecider;
}

export type ReplacementScore = { score1: number; score2: number } | { sets: Score[] } | null;

export interface ScoreEntryProps {
  names: [string, string];
  /** Eyebrow line: "Round 3 · Court 2". */
  meta?: string;
  rules: ScoreRules;
  /** Stored score when correcting; null/undefined for a fresh entry. */
  initial?: ScorePayload | null;
  initialMode: InputFormat;
  /** `sheet` is a phone bottom sheet (Save pinned at the bottom), `inline` sits in a match card. */
  surface: 'sheet' | 'inline' | 'dialog';
  /** Label fields with the team names (organizer) or "First side" / "Second side" (player). */
  fieldNames?: 'teams' | 'sides';
  submitLabel: string;
  /** Shown when the entry format is not the match's own (a player's off-format score is reviewed). */
  formatNotice?: string;
  /** Replace the Points / Sets switch with a format chip that also offers the match tie-break. */
  formatChoice?: boolean;
  /** Ask for a last look at the score before it is sent (the player surfaces). */
  confirmStep?: boolean;
  onSubmit: (payload: ScorePayload) => Promise<void> | void;
  onClose: () => void;
  /** Phone sheet: another match waits, so offer "Save and next", which saves and opens it. */
  onNext?: () => void;
  onClear?: () => void;
  extra?: (api: {
    replacement: () => ReplacementScore;
    setMode: (mode: InputFormat) => void;
  }) => ReactNode;
}

const ADVANCE_MS = 150;
const EMPTY_SETS: SetRow[] = [
  ['', ''],
  ['', ''],
  ['', ''],
];

export function errorText(e: ScoreError): string {
  switch (e.code) {
    case 'no-sets':
      return tx('Enter at least one set.');
    case 'tied':
      return tx('Set {n} cannot end level.', { n: e.n });
    case 'third':
      return tx('A third set is only played when the first two are split.');
    case 'winner':
      return tx('Enter the deciding set.');
    case 'tiebreak':
      return tx('The match tie-break is won with 10 points and a 2-point lead.');
    case 'sum':
      return tx('Scores must add up to {target}.', { target: e.target });
    default:
      return tx('Enter a score for both sides.');
  }
}

// Score entry for one match, direct input only (no quick picks): big numeric fields, Tab moves
// side 1 -> side 2 -> Save, Enter saves, Esc cancels. In sets mode a game cell holds one digit and
// focus moves on after it; the match tie-break cell takes two. Used by the organizer (sheet, inline
// row, override dialog) and by players submitting their own result.
export function ScoreEntry({
  names,
  meta,
  rules,
  initial,
  initialMode,
  surface,
  fieldNames = 'teams',
  submitLabel,
  formatNotice,
  formatChoice = false,
  confirmStep = false,
  onSubmit,
  onClose,
  onNext,
  onClear,
  extra,
}: ScoreEntryProps) {
  useLocale();
  const [mode, setModeState] = useState<InputFormat>(
    rules.modes.includes(initialMode) ? initialMode : 'points',
  );
  // The third-set format. Fixed by the match, unless the player picks it in the format chip.
  const [decider, setDecider] = useState(rules.decider);
  const [review, setReview] = useState<ScorePayload | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const pointsRef = useRef<SetRow>(
    initial?.kind === 'points' ? [String(initial.score[0]), String(initial.score[1])] : ['', ''],
  );
  const [points, setPoints] = useState<SetRow>(pointsRef.current);
  const [autoSide, setAutoSide] = useState<0 | 1 | null>(null);
  const setsRef = useRef<SetRow[]>(
    EMPTY_SETS.map((row, i): SetRow => {
      const s = initial?.kind === 'sets' ? initial.sets[i] : undefined;
      return s ? [String(s[0]), String(s[1])] : row;
    }),
  );
  const [sets, setSets] = useState<SetRow[]>(setsRef.current);
  const [error, setError] = useState<ScoreError | null>(null);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const keyed = useRef<number | null>(null);

  const resetErrors = () => {
    setError(null);
    setServerError('');
  };
  const setMode = (next: InputFormat) => {
    setModeState(next);
    resetErrors();
  };
  // The refs are the source of truth for validation and submit; state only drives rendering. A
  // Mantine NumberInput also reports on blur, so a focus change can call these before React has
  // re-rendered, and a closure over state could be one keystroke behind.
  const setPoint = (side: 0 | 1, raw: string) => {
    const other = side ? 0 : 1;
    const fill = rules.total > 0 && raw !== '';
    const next: SetRow = [...pointsRef.current];
    next[side] = raw;
    if (fill) next[other] = String(Math.max(0, rules.total - Number(raw)));
    pointsRef.current = next;
    setPoints(next);
    setAutoSide(fill ? other : null);
    resetErrors();
  };
  const setGames = (set: number, side: 0 | 1, raw: string) => {
    setsRef.current = setsRef.current.map((r, i): SetRow =>
      i === set ? (side ? [r[0], raw] : [raw, r[1]]) : r,
    );
    setSets(setsRef.current);
    resetErrors();
    // One digit finishes a normal set cell (0-7); a tie-break needs two. Focus moves on after a short
    // pause, and only if the user is still in this cell: moving it inside the change handler would
    // blur the cell first, and that blur reports the previous value back.
    if (raw.length === 1 && Number(raw) <= 7 && !isTiebreakSet(set, 3, decider)) {
      const cell = set * 2 + side;
      const element = cells.current[cell];
      // Only keys advance (physical or on-screen keyboard); a programmatic value change does not.
      const typed = keyed.current === cell;
      window.setTimeout(() => {
        if (typed && document.activeElement === element && setsRef.current[set][side] === raw)
          cells.current[cell + 1]?.focus();
      }, ADVANCE_MS);
    }
  };

  const build = (): { payload?: ScorePayload; error?: ScoreError } => {
    if (mode === 'sets') {
      const parsed = parseSets(setsRef.current);
      const err = validateSets(parsed, decider);
      return err
        ? { error: err }
        : { payload: { kind: 'sets', sets: parsed, ...(formatChoice ? { decider } : {}) } };
    }
    const current = pointsRef.current;
    const err = validatePoints(current, rules.total);
    return err
      ? { error: err }
      : { payload: { kind: 'points', score: [Number(current[0]), Number(current[1])] } };
  };
  const replacement = (): ReplacementScore => {
    const { payload } = build();
    if (!payload) return null;
    return payload.kind === 'sets'
      ? { sets: payload.sets }
      : { score1: payload.score[0], score2: payload.score[1] };
  };

  const send = async (payload: ScorePayload, advance = false) => {
    setBusy(true);
    try {
      await onSubmit(payload);
      if (advance && onNext) onNext();
      else onClose();
    } catch (x) {
      setServerError((x as Error).message);
      setBusy(false);
    }
  };
  const submit = async (event?: FormEvent, advance = false) => {
    event?.preventDefault();
    if (review) {
      await send(review, advance);
      return;
    }
    const { payload, error: err } = build();
    if (!payload) {
      setError(err ?? null);
      // First invalid field takes focus so the next keystroke fixes it.
      const empty = mode === 'points' ? pointsRef.current.findIndex((p) => p === '') : 0;
      cells.current[Math.max(0, empty)]?.focus();
      return;
    }
    if (confirmStep) {
      setReview(payload);
      return;
    }
    await send(payload, advance);
  };

  const defaultKey = formatKeyOf(rules.defaultMode, rules.decider);
  const currentKey = formatKeyOf(mode, decider);
  const chooseFormat = (key: FormatKey) => {
    setMode(key === 'points' ? 'points' : 'sets');
    if (key !== 'points') setDecider(key === 'sets_tb' ? 'match_tiebreak' : 'full_set');
    setFormatOpen(false);
  };
  const formatLabel = (key: FormatKey) =>
    key === 'points' ? tx('Points') : key === 'sets' ? tx('Sets') : tx('Sets + match tie-break');
  const keys: FormatKey[] = ['points', 'sets', 'sets_tb'];

  const onKeyDown = (event: KeyboardEvent) => {
    if (surface === 'inline' && event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };
  const fieldLabel = (side: 0 | 1) =>
    fieldNames === 'sides' ? (side ? tx('Second side') : tx('First side')) : names[side];
  const setLabel = (set: number, side: 0 | 1) => {
    const base = isTiebreakSet(set, 3, decider) ? 'Match tie-break' : `Set ${set + 1}`;
    return fieldNames === 'sides'
      ? tx(side ? '{value1} · second side' : '{value1} · first side', { value1: base })
      : `${tx('Set')} ${set + 1} - ${names[side]}`;
  };
  const scored = !!initial;

  return (
    <form
      className={classes.form}
      data-surface={surface}
      data-testid="score-sheet"
      onSubmit={(e) => void submit(e)}
      onKeyDown={onKeyDown}
      noValidate
    >
      {review ? (
        <Stack key="review" gap="md" data-testid="score-review">
          <Text variant="eyebrow">{tx('Check the score before you send it')}</Text>
          <Text fw={700} fz="1.75rem" ta="center" data-testid="review-score">
            {review.kind === 'sets'
              ? formatSets(review.sets, review.decider ?? decider, ' / ')
              : `${review.score[0]} – ${review.score[1]}`}
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            {names[0] || tx('To be decided')} {tx('vs')} {names[1] || tx('To be decided')}
          </Text>
          {review.kind === 'points' && review.score[0] === 0 && review.score[1] === 0 && (
            <Notice tone="warning">{tx('This is 0 – 0. Check it before you send it.')}</Notice>
          )}
          {formatNotice && currentKey !== defaultKey && (
            <Notice tone="warning">
              {tx(
                'Entered in a different format than set for this match. It counts once the organizer approves it.',
              )}
            </Notice>
          )}
          {serverError && (
            <Notice tone="danger" role="alert">
              {tx(serverError)}
            </Notice>
          )}
          <FormActions sticky={surface !== 'inline'}>
            <Button type="submit" size="touch" loading={busy}>
              {tx('Send this score')}
            </Button>
            <Button variant="default" size="touch" onClick={() => setReview(null)}>
              {tx('Back')}
            </Button>
          </FormActions>
        </Stack>
      ) : (
        <Stack key="form" gap="md">
          {meta && surface !== 'inline' && <Text variant="eyebrow">{meta}</Text>}
          {rules.modes.length > 1 &&
            (formatChoice ? (
              <Popover
                opened={formatOpen}
                onChange={setFormatOpen}
                position="bottom-start"
                width="min(18.75rem, calc(100vw - 2rem))"
                shadow="md"
                withinPortal={false}
                trapFocus
              >
                <Popover.Target>
                  <Button
                    variant={currentKey === defaultKey ? 'default' : 'light'}
                    color={currentKey === defaultKey ? undefined : 'orange'}
                    size="compact-md"
                    leftSection={<IconSettings size={15} />}
                    rightSection={<IconChevronDown size={14} />}
                    aria-haspopup="dialog"
                    aria-label={tx('Scoring format')}
                    data-testid="format-chip"
                    onClick={() => setFormatOpen((o) => !o)}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {formatLabel(currentKey)}
                  </Button>
                </Popover.Target>
                <Popover.Dropdown aria-label={tx('Scoring format')}>
                  <Stack gap={2}>
                    {keys
                      .filter((k) => k === 'points' || rules.modes.includes('sets'))
                      .map((k) => (
                        <NavLink
                          key={k}
                          active={k === currentKey}
                          label={formatLabel(k)}
                          description={
                            k === 'points'
                              ? tx('Enter the two totals.')
                              : k === 'sets'
                                ? tx('Games per set, and the third set played in full.')
                                : tx(
                                    'Match tie-break: first to 10, win by 2. Counts as one game in standings and ratings.',
                                  )
                          }
                          onClick={() => chooseFormat(k)}
                          data-testid={`format-${k}`}
                        />
                      ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            ) : (
              <SegmentedControl
                fullWidth
                size="md"
                value={mode}
                onChange={(v) => setMode(v as InputFormat)}
                data={[
                  { value: 'points', label: tx('Points') },
                  { value: 'sets', label: tx('Sets') },
                ]}
              />
            ))}
          {mode === 'points' ? (
            <Stack gap="sm" className={classes.board}>
              <SimpleGrid cols={surface === 'inline' ? 2 : 1} spacing="md">
                {([0, 1] as const).map((side) => (
                  <Stack key={side} gap={6}>
                    <Text fw={600} ta="center" className={classes.team}>
                      {names[side] || tx('To be decided')}
                    </Text>
                    <ScoreStepper
                      value={points[side]}
                      onChange={(v) => setPoint(side, v)}
                      label={fieldLabel(side)}
                      testId={`score-${side + 1}`}
                      autoFocus={side === 0}
                      auto={autoSide === side}
                      enterKeyHint={side === 0 ? 'next' : 'done'}
                      inputRef={(el) => {
                        cells.current[side] = el;
                      }}
                    />
                  </Stack>
                ))}
              </SimpleGrid>
              <Text size="sm" c="dimmed" ta="center">
                {rules.total > 0
                  ? tx('Scores must add up to {target}.', { target: rules.total })
                  : tx('Enter the score for each side.')}
              </Text>
            </Stack>
          ) : (
            <div className={`${classes.board} ${classes.setsGrid}`}>
              <Text fw={600} size="sm" ta="center" className={classes.team}>
                {names[0]}
              </Text>
              <span />
              <Text fw={600} size="sm" ta="center" className={classes.team}>
                {names[1]}
              </Text>
              {sets.flatMap((row, i) => [
                <ScoreStepper
                  key={`${i}-1`}
                  compact
                  onKeyDown={() => (keyed.current = i * 2)}
                  value={row[0]}
                  onChange={(v) => setGames(i, 0, v)}
                  label={setLabel(i, 0)}
                  testId={`set-${i + 1}-1`}
                  autoFocus={i === 0}
                  enterKeyHint="next"
                  inputRef={(el) => {
                    cells.current[i * 2] = el;
                  }}
                />,
                <Text
                  key={`${i}-l`}
                  size="xs"
                  c="dimmed"
                  ta="center"
                  className={classes.setLabel}
                  title={
                    isTiebreakSet(i, 3, decider)
                      ? tx(
                          'Match tie-break: first to 10, win by 2. Counts as one game in standings and ratings.',
                        )
                      : undefined
                  }
                >
                  {isTiebreakSet(i, 3, decider) ? tx('Tie-break') : `${tx('Set')} ${i + 1}`}
                </Text>,
                <ScoreStepper
                  key={`${i}-2`}
                  compact
                  onKeyDown={() => (keyed.current = i * 2 + 1)}
                  value={row[1]}
                  onChange={(v) => setGames(i, 1, v)}
                  label={setLabel(i, 1)}
                  testId={`set-${i + 1}-2`}
                  enterKeyHint={i === 2 ? 'done' : 'next'}
                  inputRef={(el) => {
                    cells.current[i * 2 + 1] = el;
                  }}
                />,
              ])}
            </div>
          )}
          {formatNotice && currentKey !== defaultKey && (
            <Notice tone="warning">{formatNotice}</Notice>
          )}
          {(error || serverError) && (
            <Notice tone="danger" role="alert">
              {error ? errorText(error) : tx(serverError)}
            </Notice>
          )}
          {extra?.({ replacement, setMode })}
          {/* FormActions keeps DOM order Save, Cancel, Clear so Tab goes last field -> Save, and shows
            Clear | Cancel | Save with Save under the right thumb. */}
          <FormActions
            sticky={surface !== 'inline'}
            start={
              scored &&
              onClear &&
              (confirmClear ? (
                <Button
                  color="red"
                  variant="light"
                  size="touch"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  {tx('Confirm: clear result')}
                </Button>
              ) : (
                <Button
                  color="red"
                  variant="subtle"
                  size="touch"
                  onClick={() => setConfirmClear(true)}
                >
                  {tx('Clear result')}
                </Button>
              ))
            }
          >
            {onNext && (
              <Button size="touch" loading={busy} onClick={() => void submit(undefined, true)}>
                {tx('Save and next')}
              </Button>
            )}
            <Button
              type="submit"
              size="touch"
              variant={onNext ? 'default' : 'filled'}
              loading={busy}
            >
              {submitLabel}
            </Button>
            <Button variant="default" size="touch" onClick={onClose}>
              {tx('Cancel')}
            </Button>
          </FormActions>
        </Stack>
      )}
    </form>
  );
}
