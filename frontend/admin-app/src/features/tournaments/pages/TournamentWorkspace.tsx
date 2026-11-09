import { sportProps } from '../../../theme';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  IconCopy,
  IconDeviceTv,
  IconDownload,
  IconPlayerStop,
  IconPin,
  IconTrash,
  IconX,
  IconArrowBackUp,
  IconCheck,
  IconPencil,
  IconSettings,
  IconActivity,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from '@tabler/icons-react';
import { Button } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { formatType, write } from '../../../api';
import { ErrorState, Loading, useOverview } from '../../../components';
import { useAuth } from '../../../auth';
import { GhostPurgeField, purgeQuery, useGhostPurge } from '../GhostPurge';
import { closeItem, useOpenItems } from '../../switcher';
import { useItemActions } from '../../switcher/actions';
import { useViewState } from '../../switcher/viewState';
import { useRegisterWorkspace } from '../../switcher/workspace';
import { prefixOf, workspaceQuery } from '../../../admin/tournament/query';
import { PlayerCodes } from '../../../admin/tournament/PlayerCodes';
import { latestRound } from '../../../admin/tournament/pairings';
import { ReviewQueue } from '../../../admin/tournament/ReviewQueue';
import { AdminScoreDialog, AdminScoreEntry } from '../../../admin/tournament/AdminScoreEntry';
import { CommentDialog, HistoryDrawer, MatchTools } from '../../../admin/tournament/MatchTools';
import { PairingsDialog } from '../../../admin/tournament/PairingsDialog';
import { PlayoffsDialog } from '../../../admin/tournament/PlayoffsDialog';
import { ExportDialog } from '../../../admin/tournament/ExportDialog';
import { TournamentSettings } from '../../../admin/settings/TournamentSettings';
import { historyOnly, pageMatches, reviewItems } from '../../../admin/tournament/scoring';
import { useRecordScore, useReviewActions } from '../../../admin/tournament/useScoreActions';
import type { Match } from '../../../types';
import { ConfirmAction, EmptyState, ResponsiveSheet } from '../../../ui';
import { MatchList } from '../MatchList';
import { ActivityList } from '../../../shell/ActivityList';
import { StandingsTable } from '../StandingsTable';
import { toStandingRows } from '../adapters';
import { Bracket } from '../Bracket';
import { formatRoundLabel } from '../../../roundLabel';
import { PhaseStepper, type PhaseKind } from '../PhaseStepper';
import { RoundBar } from '../RoundBar';
import { NextStepButton, WorkspaceHeader, type MenuEntry, type NextStep } from '../WorkspaceHeader';
import classes from '../Workspace.module.css';

// Opens the first pending match's Score button (or the given match's) once the editor has closed.
function focusScoreAction(matchId: string, next: boolean) {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const selector = next
        ? '[data-testid="match-row"]:not([data-status="completed"]) [data-score-action]'
        : `[data-match-id="${CSS.escape(matchId)}"] [data-score-action]`;
      document.querySelector<HTMLElement>(selector)?.focus();
    }),
  );
}

interface MatchScope {
  filter: string;
  round?: string;
  /** What a match's round chip value is: its number (Mexicano rounds) or its label (play-offs). */
  roundKey: (m: Match) => string;
  group?: string;
  groupOf: Map<string, string>;
}

const visibleMatches = (matches: Match[], scope: MatchScope) =>
  matches.filter(
    (m) =>
      (scope.filter === 'all' ||
        (scope.filter === 'completed' ? m.status === 'completed' : m.status !== 'completed')) &&
      (!scope.round || scope.round === 'all' || scope.roundKey(m) === scope.round) &&
      (!scope.group || scope.groupOf.get(m.id) === scope.group),
  );

type Dialog =
  | { kind: 'confirm'; title: string; action: string; body?: unknown; color?: string }
  | { kind: 'pairings'; title: string }
  | { kind: 'playoffs'; title: string }
  | { kind: 'export' }
  | { kind: 'activity' }
  | { kind: 'settings' }
  | { kind: 'delete' };

// One workspace per tournament id: switching tournaments remounts it, so editors and filters never
// leak from one event into the next, and the remembered view for the new one is restored.
export function TournamentWorkspace() {
  const { id = '' } = useParams();
  return <Workspace key={id} id={id} />;
}

function Workspace({ id }: { id: string }) {
  useLocale();
  const navigate = useNavigate();
  const { user } = useAuth();
  const client = useQueryClient();
  const { tournaments } = useOverview();
  const items = useOpenItems();
  const itemActions = useItemActions();
  const tournament = tournaments.data?.find((t) => t.id === id);
  const prefix = prefixOf(tournament?.type);
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const panes = !!useMediaQuery('(min-width: 62em)', false, { getInitialValueInEffect: false });
  // `inline` edits happen inside the match row on desktop; phones and the review queue use a sheet or dialog.
  const [editing, setEditing] = useState<{
    id: string;
    purpose: 'record' | 'resolve';
    from: 'list' | 'review';
  } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [commentFor, setCommentFor] = useState<Match | null>(null);
  const [historyFor, setHistoryFor] = useState<Match | null>(null);
  // Owners and admins only: the API restricts delete, community moves, ELO recalculation and
  // co-editor management to them (`_require_owner_or_admin`). Co-editors get `canEdit` only.
  const isOwnerOrAdmin = user?.role === 'admin' || tournament?.owner === user?.username;
  const canEdit = isOwnerOrAdmin || !!tournament?.shared;
  const query = useQuery(workspaceQuery(id, prefix, !!tournament));
  const wide = !!useMediaQuery('(min-width: 88em)', false, { getInitialValueInEffect: false });
  const page = query.data;
  // A Mexicano that ended without play-offs lists its round history, read-only.
  const history = !!page && historyOnly(page);
  const playoffCtx = !!page && !page.groupStage && page.path === 'playoffs' && !history;
  const standingGroups = page?.data.standings ?? page?.groups?.standings;
  const hasStandings = !!page && (!!page.status.leaderboard || !!standingGroups);
  const pageReviews = page && canEdit ? reviewItems(pageMatches(page), page.settings) : [];
  // Review exists only while something can reach it: a queued item, or score confirmation by players.
  const hasReview =
    !!page &&
    canEdit &&
    (pageReviews.length > 0 || page.settings.score_confirmation !== 'immediate');
  // On a phone the knockout bracket carries the match cards, so there is no second Matches tab.
  const bracketOnly = phone && playoffCtx;
  const firstView = bracketOnly ? 'bracket' : 'matches';
  const allowed = [
    ...(bracketOnly ? ['bracket'] : ['matches']),
    ...(hasStandings ? ['standings'] : []),
    ...(playoffCtx && !bracketOnly ? ['bracket'] : []),
    ...(hasReview ? ['review'] : []),
    ...(canEdit ? ['players'] : []),
  ];
  const view = useViewState(
    id,
    !!page,
    allowed,
    page?.status.phase === 'finished' ? 'all' : undefined,
  );
  const tab = view.state.view;
  const filter = view.state.filter;
  const setTab = (value: string | null) => view.patch({ view: value ?? firstView });
  const setFilter = (value: string) => view.patch({ filter: value }, { replace: true });
  const filterRef = useRef<HTMLDivElement | null>(null);
  const standingsRef = useRef<HTMLDivElement | null>(null);
  const record = useRecordScore(id, page?.ctx ?? 'mex');
  const saved = useRef(false);
  const closeEditor = (matchId: string) => {
    const afterSave = saved.current;
    saved.current = false;
    setEditing(null);
    focusScoreAction(matchId, afterSave);
  };
  const review = useReviewActions(id);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'tournament', id] });
    void client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
  };
  const advance = useMutation({
    mutationFn: () => {
      if (dialog?.kind !== 'confirm') throw new Error('Nothing to confirm');
      return write(`/tournaments/${id}/${prefix}/${dialog.action}`, dialog.body);
    },
    onSuccess: () => {
      setDialog(null);
      refresh();
      notifications.show({ message: tx('Tournament updated'), color: 'green' });
    },
  });
  // One-tap steps: no confirm, because reopening the rounds is the undo. Ending the rounds offers it
  // as an Undo button in the toast.
  const direct = useMutation({
    mutationFn: ({ action }: { action: string; message: string; undo?: boolean }) =>
      write(`/tournaments/${id}/${prefix}/${action}`),
    onSuccess: (_data, { message, undo }) => {
      const toastId = `step-${Date.now()}`;
      notifications.show({
        id: toastId,
        color: 'green',
        autoClose: undo ? 8000 : 4000,
        message: undo ? (
          <Group justify="space-between" wrap="nowrap" gap="md">
            <Text size="sm">{message}</Text>
            <Button
              size="compact-md"
              variant="white"
              onClick={() => {
                notifications.hide(toastId);
                write(`/tournaments/${id}/${prefix}/undo-end`)
                  .catch((e: Error) => notifications.show({ message: tx(e.message), color: 'red' }))
                  .finally(refresh);
              }}
            >
              {tx('Undo')}
            </Button>
          </Group>
        ) : (
          message
        ),
      });
    },
    onError: (error: Error) =>
      notifications.show({ message: tx(error.message), color: 'red', autoClose: 6000 }),
    onSettled: refresh,
  });
  const ghostPurge = useGhostPurge(dialog?.kind === 'delete' ? id : undefined);
  const remove = useMutation({
    mutationFn: () =>
      write(`/tournaments/${id}${purgeQuery(ghostPurge.purge)}`, undefined, 'DELETE'),
    onSuccess: () => {
      closeItem(id);
      void client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      navigate('/admin');
    },
  });
  // A tournament that is no longer listed disappears from the open-tournament chips.
  useEffect(() => {
    if (tournaments.data && !tournament) closeItem(id);
  }, [tournaments.data, tournament, id]);

  const loaded = query.data;
  const loadedMatches = loaded ? pageMatches(loaded) : [];
  const loadedPending = loadedMatches.filter(
    (m) => m.status !== 'completed' && m.team1.length && m.team2.length,
  );
  const confirmDialog = (
    title: string,
    action: string,
    body?: unknown,
    color?: string,
  ): Dialog => ({
    kind: 'confirm',
    title,
    action,
    body,
    color,
  });

  // The one next step the phase allows. The header button, the phone action bar, the palette and the
  // keyboard shortcut all open the same dialog; the button is disabled while matches are pending.
  const openDialog = (next: Dialog) => {
    // Score toasts (with Undo) would sit over the title of the dialog.
    notifications.clean();
    setDialog(next);
  };
  const nextAction = ((): Omit<NextStep, 'disabledReason'> | null => {
    if (!loaded || !canEdit || loaded.status.phase === 'finished') return null;
    const { status, data, groupStage } = loaded;
    if (prefix === 'mex' && status.phase === 'mexicano') {
      if (status.mexicano_ended)
        return {
          label: tx('Start play-offs'),
          onClick: () => openDialog({ kind: 'playoffs', title: tx('Start the play-offs?') }),
        };
      if (!status.num_rounds || (status.current_round ?? 0) < status.num_rounds)
        return {
          label: status.current_round ? tx('Next round') : tx('Start first round'),
          onClick: () =>
            openDialog({
              kind: 'pairings',
              title: tx(
                status.current_round ? 'Generate the next round?' : 'Start the first round?',
              ),
            }),
        };
      return {
        label: tx('End rounds'),
        onClick: () => direct.mutate({ action: 'end', message: tx('Rounds ended'), undo: true }),
      };
    }
    if (groupStage)
      return data.has_more_rounds
        ? {
            label: tx('Next group round'),
            onClick: () =>
              direct.mutate({
                action: 'next-group-round',
                message: tx('Next group round generated'),
              }),
          }
        : {
            label: tx('Start play-offs'),
            onClick: () => openDialog({ kind: 'playoffs', title: tx('Start the play-offs?') }),
          };
    return null;
  })();
  const disabledReason = loadedPending.length
    ? loadedPending.length === 1
      ? tx('1 match still to play')
      : tx('{n} matches still to play', { n: loadedPending.length })
    : undefined;
  const next: NextStep | null = nextAction ? { ...nextAction, disabledReason } : null;

  const selectedId = view.state.selectedMatchId;
  const mexRounds = prefix === 'mex' && loaded?.status.phase === 'mexicano';
  // Chips narrow the list by round: Mexicano rounds by number, play-off rounds by label.
  const roundKey = (m: Match) => (mexRounds ? String(m.round_number) : m.round_label);
  const roundValues = mexRounds
    ? []
    : [...new Set(loadedMatches.map((m) => m.round_label).filter(Boolean))];
  const round =
    view.state.round && (mexRounds || roundValues.includes(view.state.round))
      ? view.state.round
      : undefined;
  // Group filter (group stage only): the group chips in the match list and the standings share it.
  const groupOf = new Map<string, string>();
  if (loaded?.groupStage && loaded.data.matches && !Array.isArray(loaded.data.matches))
    for (const [name, list] of Object.entries(loaded.data.matches))
      for (const m of list) groupOf.set(m.id, name);
  const groupNames = Object.keys(standingGroups ?? {});
  const group =
    loaded?.groupStage && groupNames.includes(view.state.group ?? '')
      ? view.state.group
      : undefined;
  const scope: MatchScope = { filter, round, roundKey, group, groupOf };
  const visibleIds = (loaded ? visibleMatches(loadedMatches, scope) : []).map((m) => m.id);
  const scoreMatch = (matchId: string | undefined) => {
    if (!matchId || !canEdit) return;
    setEditing({ id: matchId, purpose: 'record', from: 'list' });
  };
  useRegisterWorkspace(
    {
      tid: id,
      name: tournament?.name ?? id,
      canEdit,
      nextRoundLabel: nextAction?.label ?? null,
      reviewCount: loaded && canEdit ? reviewItems(loadedMatches, loaded.settings).length : 0,
      hasPending: loadedPending.length > 0,
    },
    {
      nextRound: () => {
        if (nextAction && !disabledReason) nextAction.onClick();
      },
      scoreNext: () => {
        setTab(firstView);
        setFilter('pending');
        scoreMatch(loadedPending[0]?.id);
      },
      scoreSelected: () => scoreMatch(selectedId ?? visibleIds[0]),
      moveSelection: (delta) => {
        if (!visibleIds.length) return;
        const at = selectedId ? visibleIds.indexOf(selectedId) : -1;
        const target = visibleIds[Math.min(visibleIds.length - 1, Math.max(0, at + delta))]!;
        view.patch({ selectedMatchId: target });
        document
          .querySelector(`[data-match-id="${CSS.escape(target)}"]`)
          ?.scrollIntoView?.({ block: 'nearest' });
      },
      focusMatch: (matchId) => {
        setTab(firstView);
        setFilter('all');
        view.patch({ selectedMatchId: matchId });
        window.setTimeout(
          () =>
            document
              .querySelector(`[data-match-id="${CSS.escape(matchId)}"]`)
              ?.scrollIntoView?.({ block: 'center' }),
          60,
        );
      },
      focusFilter: () => {
        setTab(firstView);
        window.setTimeout(
          () => filterRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
          30,
        );
      },
      showView: (value) => setTab(value === 'matches' ? firstView : value),
    },
  );
  const twoPane = panes && hasStandings;
  // Desktop only: the standings column can be hidden to give the match cards the full width.
  const [standingsHidden, setStandingsHidden] = useLocalStorage<boolean>({
    key: 'amistoso-standings-hidden',
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  const showStandingsPane = twoPane && !standingsHidden;
  // Asking for the standings (tab, shortcut or deep link) brings the pane back.
  useEffect(() => {
    if (twoPane && standingsHidden && tab === 'standings') setStandingsHidden(false);
  }, [twoPane, standingsHidden, tab, setStandingsHidden]);
  // Focus the pane when entering standings, including on an initial deep link. Refreshes must not
  // steal focus from a control inside the pane.
  useEffect(() => {
    if (showStandingsPane && tab === 'standings' && standingsRef.current) {
      standingsRef.current.scrollIntoView?.({ block: 'nearest' });
      standingsRef.current.focus({ preventScroll: true });
    }
  }, [showStandingsPane, tab]);

  if (tournaments.isPending || (tournament && query.isPending)) return <Loading />;
  if (tournaments.error || query.error)
    return (
      <ErrorState
        error={tournaments.error || query.error}
        retry={() => {
          void tournaments.refetch();
          void query.refetch();
        }}
      />
    );
  if (!tournament || !query.data)
    return (
      <EmptyState title={tx('Tournament not found')}>
        {tx('It may have been removed or you may not have access.')}
      </EmptyState>
    );
  const { status, data, settings } = query.data;
  // Round history is listed with the Mexicano formatting but cannot be edited from a finished event.
  const ctx = history ? 'mex' : query.data.ctx;
  const matches = loadedMatches;
  const visible = visibleMatches(matches, scope);
  const reviews = pageReviews;
  const editingMatch = editing ? matches.find((m) => m.id === editing.id) : undefined;
  const canClear =
    status.phase !== 'finished' && !(ctx === 'gp-group' && status.phase !== 'groups');
  const done = matches.filter((m) => m.status === 'completed').length;
  const scoreable = canEdit && !history;
  const openItem = items.find((i) => i.id === id && i.kind === 'tournament');
  const itemRef = {
    id,
    kind: 'tournament' as const,
    name: tournament.name,
    pinned: openItem?.pinned,
  };
  const sitOutRound = Number(round && round !== 'all' ? round : status.current_round);
  const sitOuts = mexRounds ? status.sit_outs?.[sitOutRound - 1] : undefined;

  const menu: MenuEntry[] = [
    {
      key: 'tv',
      label: tx('TV view'),
      icon: <IconDeviceTv size={16} />,
      href: `/tv/${id}`,
      // Its own window, so the admin tab stays where it is (a second click reuses the same window).
      target: `amistoso-tv-${id}`,
    },
    {
      key: 'copy',
      label: tx('Copy public link'),
      icon: <IconCopy size={16} />,
      onClick: () => void itemActions.copyLink(itemRef),
    },
    {
      key: 'export',
      label: tx('Export results'),
      icon: <IconDownload size={16} />,
      onClick: () => setDialog({ kind: 'export' }),
    },
    ...(wide
      ? []
      : [
          {
            key: 'activity',
            label: tx('Recent activity'),
            icon: <IconActivity size={16} />,
            onClick: () => setDialog({ kind: 'activity' as const }),
          },
        ]),
    ...(canEdit
      ? [
          {
            key: 'settings',
            label: tx('Settings'),
            icon: <IconSettings size={16} />,
            onClick: () => setDialog({ kind: 'settings' }),
          },
        ]
      : []),
    {
      key: 'pin',
      label: openItem?.pinned ? tx('Unpin') : tx('Pin'),
      icon: <IconPin size={16} />,
      divider: true,
      onClick: () => itemActions.togglePin(itemRef),
    },
    {
      key: 'close',
      label: tx('Close tab'),
      icon: <IconX size={16} />,
      onClick: () => itemActions.close(itemRef),
    },
  ];
  if (canEdit && prefix === 'mex' && status.phase === 'mexicano') {
    if (status.mexicano_ended)
      menu.push(
        {
          key: 'undo-end',
          label: tx('Undo end of rounds'),
          icon: <IconArrowBackUp size={16} />,
          divider: true,
          onClick: () => direct.mutate({ action: 'undo-end', message: tx('Rounds reopened') }),
        },
        {
          key: 'finish',
          label: tx('Finish tournament'),
          icon: <IconCheck size={16} />,
          onClick: () => {
            advance.reset();
            setDialog(confirmDialog(tx('Finish this tournament?'), 'finish'));
          },
        },
      );
    else if (status.current_round)
      menu.push({
        key: 'end',
        label: tx('End rounds'),
        icon: <IconPlayerStop size={16} />,
        divider: true,
        onClick: () => direct.mutate({ action: 'end', message: tx('Rounds ended'), undo: true }),
      });
  }
  if (isOwnerOrAdmin)
    menu.push({
      key: 'delete',
      label: tx('Delete tournament'),
      icon: <IconTrash size={16} />,
      color: 'red',
      divider: true,
      onClick: () => {
        remove.reset();
        setDialog({ kind: 'delete' });
      },
    });

  const roundText = status.current_round
    ? status.num_rounds
      ? tx('Round {round} of {total}', { round: status.current_round, total: status.num_rounds })
      : tx('Round {round}', { round: status.current_round })
    : null;
  const type = tournament.type as PhaseKind;
  const phaseBar = mexRounds ? (
    <RoundBar
      rounds={status.current_round ?? 0}
      current={status.current_round ?? 0}
      value={round ?? 'all'}
      // A chosen round shows all of its matches: its results are what the chip is for.
      onChange={(value) =>
        view.patch(value === 'all' ? { round: undefined } : { round: value, filter: 'all' })
      }
    />
  ) : (
    <PhaseStepper type={type} phase={status.phase} />
  );

  const phaseNote = ((): string | null => {
    if (prefix !== 'mex') return null;
    if (status.phase === 'finished')
      return history
        ? tx('Tournament finished from the Mexicano standings (no play-offs).')
        : tx('Tournament finished after the play-offs.');
    if (status.phase !== 'mexicano') return null;
    if (status.mexicano_ended)
      return tx('Mexicano rounds ended. Start the play-offs or finish the tournament.');
    if (
      status.num_rounds &&
      (status.current_round ?? 0) >= status.num_rounds &&
      !loadedPending.length
    )
      return tx('All Mexicano rounds are complete. Ready for the play-offs.');
    return null;
  })();

  const emptyTitle = ((): { title: string; text: string } => {
    if (mexRounds && !status.current_round)
      return {
        title: tx('No round yet'),
        text: tx('Start the first round to see its matches here.'),
      };
    if (!matches.length)
      return {
        title: tx('No matches yet'),
        text: tx('Matches appear here once they are generated.'),
      };
    if (filter === 'pending' && !group && !round)
      return {
        title: tx('Every point is in.'),
        text:
          next && status.phase !== 'finished'
            ? tx('Switch the filter to see completed matches, or generate the next step.')
            : tx('Switch the filter to see completed matches.'),
      };
    return {
      title: tx('No matches to show'),
      text: tx('Switch the filter, round or group to see other matches.'),
    };
  })();

  const pendingIn = (list: Match[]) =>
    list.filter((m) => m.status !== 'completed' && m.team1.length && m.team2.length).length;
  // After "Save and next": the next pending match after this one, wrapping to the first.
  const nextToScore = (currentId: string): Match | undefined => {
    const pending = matches.filter(
      (m) =>
        m.id !== currentId &&
        m.status !== 'completed' &&
        m.team1.length &&
        m.team2.length &&
        !m.walkover,
    );
    const at = matches.findIndex((m) => m.id === currentId);
    return pending.find((m) => matches.indexOf(m) > at) ?? pending[0];
  };

  const matchesPane = (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={3}>{tx('Match centre')}</Title>
        <Group gap="xs">
          <SegmentedControl
            ref={filterRef}
            value={filter}
            onChange={setFilter}
            data={[
              { value: 'pending', label: tx('To play') },
              { value: 'completed', label: tx('Completed') },
              { value: 'all', label: tx('All matches') },
            ]}
          />
          {twoPane && (
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              leftSection={
                showStandingsPane ? (
                  <IconLayoutSidebarRightCollapse size={16} />
                ) : (
                  <IconLayoutSidebarRightExpand size={16} />
                )
              }
              aria-expanded={showStandingsPane}
              aria-controls="standings-pane"
              data-testid="standings-toggle"
              onClick={() => {
                if (showStandingsPane && tab === 'standings') setTab(firstView);
                setStandingsHidden(showStandingsPane);
              }}
            >
              {showStandingsPane ? tx('Hide standings') : tx('Show standings')}
            </Button>
          )}
        </Group>
      </Group>
      {loaded?.groupStage && groupNames.length > 1 && (
        <ScrollArea type="never" scrollbars="x">
          <SegmentedControl
            size="xs"
            value={group ?? 'all'}
            onChange={(value) =>
              view.patch({ group: value === 'all' ? undefined : value }, { replace: true })
            }
            aria-label={tx('Group (matches left)')}
            data={[
              { value: 'all', label: tx('All groups') },
              ...groupNames.map((name) => {
                const left = pendingIn(matches.filter((m) => groupOf.get(m.id) === name));
                return { value: name, label: left ? `${name} (${left})` : name };
              }),
            ]}
          />
        </ScrollArea>
      )}
      {playoffCtx && !phone && roundValues.length > 1 && (
        <ScrollArea type="never" scrollbars="x">
          <SegmentedControl
            size="xs"
            value={round ?? 'all'}
            onChange={(value) =>
              view.patch(value === 'all' ? { round: undefined } : { round: value, filter: 'all' })
            }
            aria-label={tx('Round', { context: 'knockout' })}
            data={[
              { value: 'all', label: tx('All') },
              ...roundValues.map((label) => ({ value: label, label: formatRoundLabel(label) })),
            ]}
          />
        </ScrollArea>
      )}
      {!!sitOuts?.length && (
        <Text size="sm" c="dimmed">
          {tx('Sitting out: {names}', { names: sitOuts.join(', ') })}
        </Text>
      )}
      {!visible.length ? (
        <EmptyState title={emptyTitle.title}>{emptyTitle.text}</EmptyState>
      ) : (
        <MatchList
          matches={visible}
          ctx={ctx}
          settings={settings}
          canEdit={scoreable}
          selectedId={selectedId}
          editingId={editing && !phone && editing.from === 'list' ? editing.id : null}
          onScore={(m) => setEditing({ id: m.id, purpose: 'record', from: 'list' })}
          quick={
            phone
              ? undefined
              : {
                  totalPoints: status.total_points_per_match ?? 0,
                  onSave: (m, payload) => {
                    void record.mutate({ match: m, payload });
                    focusScoreAction(m.id, true);
                  },
                }
          }
          renderMenu={(m) => (
            <MatchTools match={m} onComment={setCommentFor} onHistory={setHistoryFor} />
          )}
          renderEditor={(m) => (
            <AdminScoreEntry
              key={`${m.id}-record`}
              surface="inline"
              tid={id}
              match={m}
              ctx={ctx}
              settings={settings}
              totalPoints={status.total_points_per_match ?? 0}
              purpose="record"
              canClear={canClear}
              onClose={() => closeEditor(m.id)}
              onSubmit={(payload) => {
                saved.current = true;
                void record.mutate({ match: m, payload });
              }}
            />
          )}
        />
      )}
    </Stack>
  );

  const standingsGroup = groupNames.includes(view.state.group ?? '')
    ? view.state.group!
    : groupNames[0];
  // After the group stage the results stay readable here: standings and every group match.
  const readOnlyGroupMatches =
    !data.standings && loaded?.groups?.matches && !Array.isArray(loaded.groups.matches)
      ? (loaded.groups.matches[standingsGroup ?? ''] ?? [])
      : [];
  const standingsPane = status.leaderboard ? (
    <StandingsTable rows={toStandingRows(status.leaderboard)} preset="mexicano" />
  ) : standingGroups ? (
    <Stack gap="md">
      {groupNames.length > 1 && (
        <SegmentedControl
          value={standingsGroup}
          onChange={(value) => view.patch({ group: value }, { replace: true })}
          aria-label={tx('Group')}
          data={groupNames.map((name) => ({ value: name, label: tx('Group {name}', { name }) }))}
        />
      )}
      {standingsGroup && (
        <Stack gap="xs">
          <Title order={2}>{tx('Group {name}', { name: standingsGroup })}</Title>
          <StandingsTable
            rows={toStandingRows(standingGroups[standingsGroup] ?? [])}
            preset="group"
            density="compact"
          />
        </Stack>
      )}
      {readOnlyGroupMatches.length > 0 && (
        <Stack gap="xs">
          <Text variant="eyebrow">{tx('Group matches')}</Text>
          <MatchList
            matches={readOnlyGroupMatches}
            ctx="gp-group"
            settings={settings}
            canEdit={false}
            onScore={() => undefined}
          />
        </Stack>
      )}
    </Stack>
  ) : null;

  return (
    <Stack
      gap={0}
      pb={phone && next ? (next.disabledReason ? 96 : 72) : 0}
      {...sportProps(tournament.sport)}
    >
      <WorkspaceHeader
        name={tournament.name}
        eyebrow={`${formatType(tournament.type)} · ${tournament.sport === 'padel' ? tx('Padel') : tx('Tennis')} · ${tournament.club_name || tournament.community_name}`}
        phase={status.phase}
        phaseBar={phaseBar}
        roundText={roundText}
        played={done}
        total={matches.length}
        reviewCount={reviews.length}
        onReview={() => setTab('review')}
        next={next}
        menu={menu}
        phone={phone}
        champion={status.champion}
      />
      {phaseNote && (
        <Alert color="court" variant="light" mb="md" data-testid="phase-note">
          {phaseNote}
        </Alert>
      )}
      <Tabs value={twoPane && tab === 'standings' ? 'matches' : tab} onChange={setTab}>
        <Tabs.List mb="md">
          {bracketOnly && <Tabs.Tab value="bracket">{tx('Matches')}</Tabs.Tab>}
          {twoPane ? (
            <Tabs.Tab value="matches">{tx('Overview')}</Tabs.Tab>
          ) : (
            <>
              {!bracketOnly && <Tabs.Tab value="matches">{tx('Matches')}</Tabs.Tab>}
              {hasStandings && <Tabs.Tab value="standings">{tx('Standings')}</Tabs.Tab>}
            </>
          )}
          {playoffCtx && !bracketOnly && <Tabs.Tab value="bracket">{tx('Bracket')}</Tabs.Tab>}
          {hasReview && (
            <Tabs.Tab
              value="review"
              rightSection={
                reviews.length ? (
                  <Badge
                    size="sm"
                    circle
                    color="red"
                    aria-label={tx('{n} to review', { n: reviews.length })}
                  >
                    {reviews.length}
                  </Badge>
                ) : undefined
              }
            >
              {tx('Review')}
            </Tabs.Tab>
          )}
          {canEdit && <Tabs.Tab value="players">{tx('Players')}</Tabs.Tab>}
        </Tabs.List>
        {!twoPane && !bracketOnly && <Tabs.Panel value="matches">{matchesPane}</Tabs.Panel>}
        {!twoPane && hasStandings && <Tabs.Panel value="standings">{standingsPane}</Tabs.Panel>}
        {playoffCtx && (
          <Tabs.Panel value="bracket">
            <Bracket
              matches={matches}
              ctx={ctx}
              settings={settings}
              tid={id}
              prefix={prefix}
              pendingChip={bracketOnly}
              actions={
                canEdit
                  ? (m) =>
                      m.team1.length && m.team2.length && !m.walkover ? (
                        <Button
                          size="compact-sm"
                          variant={m.status === 'completed' ? 'subtle' : 'light'}
                          color={m.status === 'completed' ? 'gray' : 'court'}
                          leftSection={
                            m.status === 'completed' ? (
                              <IconPencil size={14} />
                            ) : (
                              <IconCheck size={14} />
                            )
                          }
                          aria-label={`${tx('Score', { context: 'action' })}: ${m.team1.join(' & ')} vs ${m.team2.join(' & ')}`}
                          onClick={() =>
                            setEditing({ id: m.id, purpose: 'record', from: 'review' })
                          }
                        >
                          {m.status === 'completed'
                            ? tx('Edit')
                            : tx('Score', { context: 'action' })}
                        </Button>
                      ) : null
                  : undefined
              }
            />
          </Tabs.Panel>
        )}
        {hasReview && (
          <Tabs.Panel value="review">
            <ReviewQueue
              tid={id}
              items={reviews}
              ctx={ctx}
              settings={settings}
              onOverride={(m, purpose) => setEditing({ id: m.id, purpose, from: 'review' })}
            />
          </Tabs.Panel>
        )}
        {canEdit && (
          <Tabs.Panel value="players">
            <PlayerCodes
              tid={id}
              name={tournament.name}
              withdrawals={{
                list: status.withdrawals ?? [],
                unavailable: status.withdraw_unavailable_ids ?? [],
                phase: status.phase,
                canWithdraw: prefix !== 'mex' || status.phase === 'playoffs',
              }}
              roster={{ prefix, phase: status.phase, groups: loaded?.groupStage ? groupNames : [] }}
            />
          </Tabs.Panel>
        )}
      </Tabs>
      {twoPane && (tab === 'matches' || tab === 'standings') && (
        <div className={classes.panes} data-standings={showStandingsPane ? undefined : 'hidden'}>
          <div>{matchesPane}</div>
          {showStandingsPane && (
            <Paper
              id="standings-pane"
              ref={standingsRef}
              tabIndex={-1}
              p="md"
              className={classes.standingsPane}
              aria-label={tx('Standings')}
              data-testid="standings-pane"
            >
              {standingsPane}
            </Paper>
          )}
        </div>
      )}
      {phone && next && (
        <div className={classes.actionBar} data-testid="action-bar">
          <NextStepButton step={next} full />
        </div>
      )}
      {editing && editingMatch && (phone || editing.from === 'review') && (
        <AdminScoreDialog
          key={`${editing.id}-${editing.purpose}`}
          tid={id}
          match={editingMatch}
          ctx={ctx}
          settings={settings}
          totalPoints={status.total_points_per_match ?? 0}
          purpose={editing.purpose}
          canClear={canClear}
          onClose={() => setEditing(null)}
          onNext={
            phone && editing.purpose === 'record' && nextToScore(editing.id)
              ? () => {
                  const target = nextToScore(editing.id);
                  setEditing(
                    target ? { id: target.id, purpose: 'record', from: editing.from } : null,
                  );
                }
              : undefined
          }
          onSubmit={(payload) =>
            editing.purpose === 'resolve'
              ? review.resolve(
                  editingMatch,
                  payload.kind === 'sets'
                    ? { chosen: 'custom', sets: payload.sets }
                    : { chosen: 'custom', score1: payload.score[0], score2: payload.score[1] },
                )
              : void record.mutate({ match: editingMatch, payload })
          }
        />
      )}
      {commentFor && (
        <CommentDialog tid={id} match={commentFor} onClose={() => setCommentFor(null)} />
      )}
      {historyFor && (
        <HistoryDrawer tid={id} match={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {dialog?.kind === 'pairings' && (
        <PairingsDialog
          tid={id}
          title={dialog.title}
          players={status.players ?? []}
          sitOutCount={status.sit_out_count ?? 0}
          missedGames={status.missed_games}
          partnerBalance={status.partner_balance_weight ?? 1}
          teamMode={!!status.team_mode}
          skillGap={status.skill_gap ?? null}
          ratings={Object.fromEntries(
            (status.leaderboard ?? []).map((r) => [
              r.player_id,
              { avg: r.avg_points ?? 0, total: r.total_points ?? 0 },
            ]),
          )}
          previousRound={latestRound(loadedMatches)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'playoffs' && (prefix === 'gp' || prefix === 'mex') && (
        <PlayoffsDialog
          tid={id}
          prefix={prefix}
          title={dialog.title}
          playerCount={status.players?.length ?? status.leaderboard?.length ?? 0}
          fixedTeams={!!status.team_mode}
          composable={prefix === 'mex' || tournament.sport === 'tennis'}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'settings' && canEdit && (
        <TournamentSettings
          tournament={tournament}
          status={status}
          settings={settings}
          prefix={prefix}
          isOwnerOrAdmin={isOwnerOrAdmin}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'activity' && (
        <ResponsiveSheet opened onClose={() => setDialog(null)} title={tx('Recent activity')}>
          <ActivityList matches={matches} />
        </ResponsiveSheet>
      )}
      {dialog?.kind === 'export' && (
        <ExportDialog
          tid={id}
          name={tournament.name}
          prefix={prefix}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmAction
        opened={dialog?.kind === 'confirm' || (dialog?.kind === 'delete' && isOwnerOrAdmin)}
        title={
          dialog?.kind === 'confirm'
            ? dialog.title
            : dialog?.kind === 'delete'
              ? tx('Delete tournament')
              : undefined
        }
        description={
          dialog?.kind === 'delete' ? (
            <>
              {tx('Delete «{name}»? This cannot be undone.', { name: tournament.name })}
              <GhostPurgeField
                ghosts={ghostPurge.ghosts}
                purge={ghostPurge.purge}
                onChange={ghostPurge.setPurge}
              />
            </>
          ) : (
            tx('This updates the tournament and its public view.')
          )
        }
        confirmLabel={dialog?.kind === 'delete' ? tx('Delete') : undefined}
        color={dialog?.kind === 'delete' ? 'red' : undefined}
        error={dialog?.kind === 'delete' ? remove.error : advance.error}
        loading={dialog?.kind === 'delete' ? remove.isPending : advance.isPending}
        onConfirm={() => (dialog?.kind === 'delete' ? remove.mutate() : advance.mutate())}
        onClose={() => setDialog(null)}
      />
    </Stack>
  );
}

// Kept so the router, the dock prefetch and older imports keep one entry point.
export const TournamentPage = TournamentWorkspace;
