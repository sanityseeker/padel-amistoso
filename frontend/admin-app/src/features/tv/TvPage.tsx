import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDocumentTitle } from '@mantine/hooks';
import {
  IconMaximize,
  IconSpeakerphone,
  IconMinimize,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api';
import { ErrorState, Loading } from '../../components';
import { publicApi } from '../../events/api';
import { t as tx, useLocale } from '../../i18n';
import { BrandLogo } from '../../BrandLogo';
import { DisplayButton } from '../../shell/DisplayMenu';
import { followTournament, TOURNAMENT_UPDATE_EVENT } from '../../shell/followTournament';
import { sportProps } from '../../theme';
import { StatusBadge } from '../../ui';
import { Markdown } from '../public/Markdown';
import { PlayerCardModal } from './PlayerCardModal';
import { Champions, sectionKeys, TvBoard } from './TvBoard';
import { Section, useOpenState } from './TvSection';
import { HubInvite, TvPlayerBar } from './TvPlayerBar';
import { TvPaymentButton } from './TvPayment';
import { loadLive, resolveSlug, type TvMeta } from './model';
import { useTvPlayer } from './useTvPlayer';
import classes from './Tv.module.css';
import { Notice } from '../../ui/Notice';

const CYCLE_MS = 15_000;

const PHASE: Record<string, string> = {
  setup: 'Setup',
  groups: 'Group stage',
  playoffs: 'Play-offs',
  finished: 'Finished',
  mexicano: 'Mexicano',
};

/** Seconds until the next automatic refresh, ticking once a second. */
function useCountdown(updatedAt: number, seconds: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return Math.max(0, seconds - Math.floor((now - updatedAt) / 1000));
}

// The spectator screen (`/tv/<alias or id>`). Everything on it is public: nothing here sends the
// organizer token, and a signed-in player acts only with their tournament token. It refreshes the way
// the organizer chose: every N seconds, "on update" (server-sent events, with polling as a fallback) or
// by hand. "Present" cycles through the sections for an unattended venue screen.
export function TvPage() {
  const { slug = '' } = useParams();
  // Keyed by slug: another tournament's screen starts with fresh state.
  return <Tv key={slug} slug={slug} />;
}

function Tv({ slug }: { slug: string }) {
  useLocale();
  const [params] = useSearchParams();
  const resolved = useQuery({
    queryKey: ['public', 'tv', 'resolve', slug],
    queryFn: () => resolveSlug(slug),
    staleTime: Infinity,
    retry: false,
  });
  const tid = resolved.data;
  // One open/closed state for every collapsible section (the board's and the custom info's).
  const openState = useOpenState(tid ?? '');
  const metaQuery = useQuery({
    queryKey: ['public', 'tv', tid, 'meta'],
    enabled: !!tid,
    queryFn: () => publicApi<TvMeta>(`/tournaments/${tid}/meta`),
    retry: false,
  });
  const meta = metaQuery.data;
  const live = useQuery({
    queryKey: ['public', 'tv', tid, 'live'],
    enabled: !!tid && !!meta,
    queryFn: () => loadLive(tid!, meta!.type),
    refetchOnWindowFocus: false,
    // Timer mode refreshes on the clock; "on update" and "manual" never poll.
    refetchInterval: (query) => {
      const secs = query.state.data?.settings.refresh_interval ?? 15;
      return secs > 0 ? secs * 1000 : false;
    },
    placeholderData: (previous) => previous,
  });
  const data = live.data;
  const mode = data?.settings.refresh_interval ?? 15;
  const player = useTvPlayer(tid, data ? data.settings.allow_player_scoring !== false : undefined);
  const { refreshOpponents } = player;

  // The live-update stream belongs to the shell (one connection); this page only names the tournament.
  useEffect(() => {
    if (!tid) return;
    followTournament(tid);
    return () => followTournament(null);
  }, [tid]);
  // "On update": a changed version refetches now, or when the tab is visible again.
  const lastVersion = useRef<unknown>(undefined);
  const stale = useRef(false);
  const { refetch } = live;
  useEffect(() => {
    if (mode !== -1) return;
    const changed = (event: Event) => {
      const version = (event as CustomEvent).detail;
      if (version !== null && version === lastVersion.current) return;
      lastVersion.current = version;
      if (document.hidden) stale.current = true;
      else {
        void refetch();
        refreshOpponents();
      }
    };
    // Seed the version the screen is showing, so the stream's first message is not mistaken for a change.
    void publicApi<{ version: unknown }>(`/tournaments/${tid}/version`)
      .then((v) => {
        if (lastVersion.current === undefined) lastVersion.current = v.version;
      })
      .catch(() => undefined);
    const visible = () => {
      if (!document.hidden && stale.current) {
        stale.current = false;
        void refetch();
      }
    };
    window.addEventListener(TOURNAMENT_UPDATE_EVENT, changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener(TOURNAMENT_UPDATE_EVENT, changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [mode, refetch, refreshOpponents, tid]);

  useDocumentTitle(
    meta
      ? `${tx(meta.sport === 'tennis' ? 'Tennis TV' : 'Padel TV')} | ${meta.name}`
      : tx('Loading tournament display…'),
  );

  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.().catch(() => undefined);
  const [present, setPresent] = useState(params.get('present') === '1');
  const [step, setStep] = useState(0);
  const sections = useMemo(() => (data ? sectionKeys(data) : []), [data]);
  useEffect(() => {
    if (!present || sections.length < 2) return;
    const timer = window.setInterval(() => setStep((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [present, sections.length]);
  const only = present && sections.length > 0 ? sections[step % sections.length].key : undefined;
  const [card, setCard] = useState<string | null>(null);
  const closeCard = useCallback(() => setCard(null), []);
  const countdown = useCountdown(live.dataUpdatedAt, mode);

  if (resolved.error || metaQuery.error) {
    const error = (resolved.error ?? metaQuery.error) as Error;
    if (error instanceof ApiError && error.status === 404) {
      const to = new URLSearchParams({
        m: tx(
          'Tournament data not found. The link may be wrong or the tournament may have been deleted.',
        ),
        to: '/events',
      });
      return <Navigate to={`/404?${to}`} replace />;
    }
    return (
      <Box p="md" maw={720} mx="auto">
        <ErrorState error={error} retry={() => void metaQuery.refetch()} />
      </Box>
    );
  }
  if (!meta) return <Loading />;

  const phase = data?.status.phase || meta.phase || '';
  const slugLabel = meta.alias || meta.id;
  // The built-in open community has no identity worth printing under the title.
  const identity =
    meta.club_name || (meta.community_id === 'open' ? '' : meta.community_name) || '';
  const finished = !!data?.status.champion || phase === 'finished';
  return (
    <Box className={classes.page} {...sportProps(meta.sport)} data-testid="tv-page">
      {/* The same slim bar as the app header: the logo home to Events, the screen's controls and the
          player's initials on the right. The refresh countdown is words, so it waits for room. */}
      <header className={classes.bar}>
        <Link to="/events" className={classes.home} aria-label={tx('Events')}>
          <BrandLogo size={32} />
        </Link>
        <Group gap={2} wrap="nowrap" justify="flex-end" miw={0}>
          {data && mode > 0 && (
            <Text c="dimmed" size="sm" visibleFrom="sm" mr="xs" role="status" aria-live="off">
              {tx('Refreshes in {seconds}s', { seconds: countdown })}
            </Text>
          )}
          {data && mode === 0 && (
            <Text c="dimmed" size="sm" visibleFrom="sm" mr="xs">
              {tx('Manual only')}
            </Text>
          )}
          {data && mode !== -1 && (
            <Tooltip label={tx('Refresh now')}>
              <ActionIcon
                size="lg"
                aria-label={tx('Refresh now')}
                loading={live.isFetching}
                onClick={() => {
                  void live.refetch();
                  player.refreshOpponents();
                }}
              >
                <IconRefresh size={19} />
              </ActionIcon>
            </Tooltip>
          )}
          {sections.length > 1 && (
            <Tooltip label={present ? tx('Show all sections') : tx('Cycle the sections')}>
              <ActionIcon
                size="lg"
                variant={present ? 'filled' : undefined}
                aria-label={present ? tx('Show all sections') : tx('Cycle the sections')}
                aria-pressed={present}
                onClick={() => setPresent((p) => !p)}
              >
                {present ? <IconPlayerPause size={19} /> : <IconPlayerPlay size={19} />}
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={fullscreen ? tx('Exit full screen') : tx('Full screen')}>
            <ActionIcon
              size="lg"
              aria-label={fullscreen ? tx('Exit full screen') : tx('Full screen')}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <IconMinimize size={19} /> : <IconMaximize size={19} />}
            </ActionIcon>
          </Tooltip>
          <DisplayButton compact />
          {data && data.settings.allow_player_scoring !== false && tid && (
            <TvPlayerBar tid={tid} player={player} />
          )}
        </Group>
      </header>
      <Stack gap="lg" p={{ base: 'sm', sm: 'lg', lg: 'xl' }} maw={3600} mx="auto">
        <Stack gap="xs" align="center" ta="center">
          <Group gap="md" justify="center" wrap="nowrap" maw="100%">
            {meta.club_logo_url && (
              <Image src={meta.club_logo_url} alt="" className={classes.logo} fit="contain" />
            )}
            <Title order={1} className={classes.title}>
              {meta.name}
            </Title>
          </Group>
          {identity && (
            <Text c="dimmed" fw={600} className={classes.text}>
              {identity}
            </Text>
          )}
          <Group gap="xs" justify="center">
            {phase && !finished && (
              <StatusBadge tone="info" size="xl" fz="var(--fs-tv-md)" h="auto" py={4}>
                {tx(PHASE[phase] ?? phase)}
              </StatusBadge>
            )}
            {finished && (
              <StatusBadge tone="neutral" size="xl" fz="var(--fs-tv-md)" h="auto" py={4}>
                {tx('Finished')}
              </StatusBadge>
            )}
            <Tooltip
              label={tx('Tournament ID — tap to copy (use in Player Hub to link this event)')}
            >
              <UnstyledButton
                className={classes.chip}
                onClick={() => void navigator.clipboard?.writeText(slugLabel)}
                aria-label={tx('Copy the tournament ID: {id}', { id: slugLabel })}
              >
                <Badge
                  size="xl"
                  variant="outline"
                  color="gray"
                  ff="monospace"
                  fz="var(--fs-tv-md)"
                  h="auto"
                  py={4}
                >
                  {slugLabel}
                </Badge>
              </UnstyledButton>
            </Tooltip>
          </Group>
        </Stack>

        {data && tid && <HubInvite tid={tid} player={player} />}
        {data && tid && <TvPaymentButton tid={tid} session={player.session} />}
        {data?.settings.banner_text?.trim() && (
          <Notice icon={<IconSpeakerphone />} data-testid="tv-banner">
            <Text className={classes.banner}>{data.settings.banner_text.trim()}</Text>
          </Notice>
        )}
        {data?.settings.custom_info_text?.trim() && (
          <Section
            id="custom-info"
            title={data.settings.custom_info_title?.trim() || tx('Information')}
            state={openState}
          >
            <Box className={classes.customInfoMarkdown} data-testid="tv-custom-info">
              <Markdown source={data.settings.custom_info_text.trim()} />
            </Box>
          </Section>
        )}
        {live.error && !data && <ErrorState error={live.error} retry={() => void live.refetch()} />}
        {!data && !live.error && <Loading />}
        {data && <Champions live={data} />}
        {data && tid && (
          <TvBoard
            tid={tid}
            state={openState}
            meta={meta}
            live={data}
            player={player}
            onCard={setCard}
            only={only}
          />
        )}
        {present && sections.length > 1 && (
          <Group justify="center" gap={6} aria-label={tx('Sections')}>
            {sections.map((s, i) => (
              <Paper
                key={s.key}
                component="button"
                type="button"
                p={0}
                w={only === s.key ? 36 : 12}
                h={12}
                radius="xl"
                bg={only === s.key ? 'var(--sport-accent)' : 'var(--color-border)'}
                style={{ border: 0, cursor: 'pointer' }}
                aria-label={s.label}
                aria-current={only === s.key}
                onClick={() => setStep(i)}
              />
            ))}
          </Group>
        )}
      </Stack>
      {tid && <PlayerCardModal tid={tid} playerId={card} onClose={closeCard} />}
    </Box>
  );
}
