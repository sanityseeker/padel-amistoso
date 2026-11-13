import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../ui';
import { createPortal } from 'react-dom';
import {
  ActionIcon,
  Anchor,
  Button,
  Code,
  Group,
  Image,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { MatchListFrame } from '../../features/tournaments';
import './tournament.css';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCopy,
  IconDots,
  IconMail,
  IconPrinter,
  IconQrcode,
  IconRefresh,
  IconShare,
  IconUserCheck,
  IconUserMinus,
  IconUserPlus,
  IconAddressBook,
  IconLink,
  IconTrash,
} from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { ApiError, TOKEN_KEY, api, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import type {
  PlayerSecret,
  PlayerSecrets,
  RegeneratedSecret,
  WithdrawalSummary,
} from '../../types';
import { useAuth } from '../../auth';
import { useSendOne } from '../settings/CommunicateSection';
import { UndoWithdrawal, WithdrawDialog, WithdrawnBadge } from './Withdrawals';
import { AddPlayerDialog, ContactSheet, LinkProfileSheet, RemovePlayerDialog } from './PlayerTools';

// Tap opens the tooltip on phones too, where there is no hover.
const TOOLTIP_EVENTS = { hover: true, focus: true, touch: true };

export const joinLink = (tid: string, token: string) =>
  `${window.location.origin}/tv/${tid}?player_token=${encodeURIComponent(token)}`;

// The QR endpoint needs the admin JWT, so an <img src> cannot call it: fetch the PNG and show
// it as a data URL. No QR library ships to the browser.
async function fetchQr(tid: string, playerId: string): Promise<string> {
  const token = localStorage.getItem(TOKEN_KEY);
  const origin = encodeURIComponent(window.location.origin);
  const response = await fetch(
    `/api/tournaments/${tid}/player-secrets/qr/${playerId}?origin=${origin}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!response.ok) throw new ApiError(tx('Unable to load the QR code.'), response.status);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(tx('Unable to load the QR code.')));
    reader.readAsDataURL(blob);
  });
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ message: done, color: 'green', autoClose: 2500 });
  } catch {
    notifications.show({ message: tx('Copy is not available in this browser.'), color: 'red' });
  }
}

// Web Share where the browser has it (phones), otherwise copy the link.
async function share(tid: string, player: PlayerSecret) {
  const url = joinLink(tid, player.token);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: player.name,
        text: tx('Your link for {name}', { name: player.name }),
        url,
      });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  await copy(url, tx('Link copied'));
}

function QrDialog({
  tid,
  playerId,
  player,
  onClose,
}: {
  tid: string;
  playerId: string;
  player: PlayerSecret;
  onClose: () => void;
}) {
  useLocale();
  const qr = useQuery({
    queryKey: ['admin', 'qr', tid, playerId, player.token],
    queryFn: () => fetchQr(tid, playerId),
    staleTime: Infinity,
  });
  return (
    <Modal opened onClose={onClose} title={player.name} size="sm">
      <Stack align="center" gap="sm">
        {qr.data ? (
          <Image
            src={qr.data}
            alt={tx('QR code')}
            w="min(280px, 100%)"
            fit="contain"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : qr.error ? (
          <Text c="red">{tx(qr.error.message)}</Text>
        ) : (
          <Loading />
        )}
        <Code fz="lg">{player.passphrase}</Code>
        <Group>
          <Button
            variant="light"
            size="touch"
            leftSection={<IconShare size={16} />}
            onClick={() => void share(tid, player)}
          >
            {tx('Share link')}
          </Button>
          <Button variant="default" size="touch" onClick={onClose}>
            {tx('Close')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface PrintCard {
  id: string;
  name: string;
  passphrase: string;
  qr: string | null;
}

// One printed sheet with every player's QR and passphrase. It is mounted only while printing and
// the page hides everything else through `html[data-print-codes]` (see tournament.css).
function PrintSheet({
  title,
  cards,
  onDone,
}: {
  title: string;
  cards: PrintCard[];
  onDone: () => void;
}) {
  useEffect(() => {
    document.documentElement.dataset.printCodes = '1';
    const finish = () => onDone();
    window.addEventListener('afterprint', finish, { once: true });
    let live = true;
    void Promise.all(
      Array.from(document.querySelectorAll('.codes-print img')).map((i) =>
        (i as HTMLImageElement).decode().catch(() => undefined),
      ),
    ).then(() => {
      if (live) window.print();
    });
    return () => {
      live = false;
      delete document.documentElement.dataset.printCodes;
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);
  return createPortal(
    <div className="codes-print" data-testid="codes-print">
      <h1>{title}</h1>
      <div className="codes-print__grid">
        {cards.map((c) => (
          <div className="codes-print__card" key={c.id}>
            <div className="codes-print__name">{c.name}</div>
            {c.qr && <img src={c.qr} alt="" />}
            <div className="codes-print__label">{tx('Passphrase')}</div>
            <div className="codes-print__pass">{c.passphrase}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export interface WithdrawalContext {
  list: WithdrawalSummary[];
  /** Entries whose bracket run is over: no Withdraw button. */
  unavailable: string[];
  phase: string;
  /** Mexicano rounds keep their own (P6b) remove action instead of withdrawals. */
  canWithdraw: boolean;
}

/** Whether the row can still withdraw: the action lives in the row's options menu. */
function canWithdrawEntry(id: string, ctx: WithdrawalContext) {
  return (
    ctx.canWithdraw &&
    ctx.phase !== 'finished' &&
    !ctx.unavailable.includes(id) &&
    !ctx.list.some((w) => w.member_ids.includes(id))
  );
}

/** A withdrawn entry shows its badge (and Undo while it is allowed) in the row. */
function WithdrawnStatus({ tid, id, ctx }: { tid: string; id: string; ctx: WithdrawalContext }) {
  const done = ctx.list.find((w) => w.member_ids.includes(id));
  if (!done) return null;
  return (
    <Group gap={6} wrap="nowrap">
      <WithdrawnBadge />
      {done.undo_allowed && <UndoWithdrawal tid={tid} entryKey={done.entry_key} name={done.name} />}
    </Group>
  );
}

export interface RosterContext {
  /** `mex` allows removing a player; `mex` and `gp` allow adding one. */
  prefix: 'mex' | 'gp' | 'po';
  phase: string;
  groups: string[];
}

export function PlayerCodes({
  tid,
  name,
  withdrawals,
  roster,
}: {
  tid: string;
  name: string;
  withdrawals?: WithdrawalContext;
  roster?: RosterContext;
}) {
  useLocale();
  const { user } = useAuth();
  const sendOne = useSendOne(`/tournaments/${tid}`);
  const [adding, setAdding] = useState(false);
  const [removeFor, setRemoveFor] = useState<string | null>(null);
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const canAdd =
    !!roster &&
    ((roster.prefix === 'mex' && roster.phase === 'mexicano') ||
      (roster.prefix === 'gp' && roster.phase === 'groups'));
  const canRemove = roster?.prefix === 'mex' && roster.phase === 'mexicano';
  const client = useQueryClient();
  const key = ['admin', 'codes', tid];
  const codes = useQuery({
    queryKey: key,
    queryFn: () => api<PlayerSecrets>(`/tournaments/${tid}/player-secrets`),
  });
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [cards, setCards] = useState<PrintCard[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const done = useCallback(() => setCards(null), []);

  const store = (updated: Record<string, RegeneratedSecret>) =>
    client.setQueryData<PlayerSecrets>(key, (old) =>
      old
        ? {
            ...old,
            players: Object.fromEntries(
              Object.entries(old.players).map(([id, p]) => [
                id,
                updated[id]
                  ? { ...p, passphrase: updated[id].passphrase, token: updated[id].token }
                  : p,
              ]),
            ),
          }
        : old,
    );
  const regenerate = useMutation({
    mutationFn: async (ids: string[]) => {
      const done: Record<string, RegeneratedSecret> = {};
      for (const id of ids)
        done[id] = await write<RegeneratedSecret>(
          `/tournaments/${tid}/player-secrets/regenerate/${id}`,
        );
      return done;
    },
    onSuccess: (done) => {
      store(done);
      notifications.show({ message: tx('Codes regenerated'), color: 'green' });
    },
    onError: (e) => notifications.show({ message: tx(e.message), color: 'red' }),
  });

  if (codes.isPending) return <Loading />;
  if (codes.error) return <ErrorState error={codes.error} retry={() => void codes.refetch()} />;
  const entries = Object.entries(codes.data.players);
  if (!entries.length && !canAdd)
    // Finished events keep their codes for 360 days, then the server deletes them (by design).
    return roster?.phase === 'finished' ? (
      <EmptyState title={tx('No player codes')}>
        {tx('Player codes are kept for 360 days after a tournament finishes.')}
      </EmptyState>
    ) : (
      <EmptyState title={tx('No player codes yet.')} />
    );

  const print = async () => {
    setPreparing(true);
    try {
      const built = await Promise.all(
        entries.map(async ([id, p]) => ({
          id,
          name: p.name,
          passphrase: p.passphrase,
          qr: await client
            .fetchQuery({
              queryKey: ['admin', 'qr', tid, id, p.token],
              queryFn: () => fetchQr(tid, id),
              staleTime: Infinity,
            })
            .catch(() => null),
        })),
      );
      setCards(built);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {tx(
          'Players sign in with a passphrase or by scanning their QR code, then score their own matches.',
        )}
      </Text>
      <Group gap="xs">
        <Button
          variant="light"
          size="touch"
          leftSection={<IconCopy size={16} />}
          onClick={() =>
            void copy(
              entries.map(([, p]) => `${p.name}: ${p.passphrase}`).join('\n'),
              tx('Codes copied'),
            )
          }
        >
          {tx('Copy all codes')}
        </Button>
        <Button
          variant="light"
          size="touch"
          leftSection={<IconPrinter size={16} />}
          loading={preparing}
          onClick={() => void print()}
        >
          {tx('Print all codes')}
        </Button>
        <Button
          variant="subtle"
          color="gray"
          size="touch"
          leftSection={<IconRefresh size={16} />}
          onClick={() => setConfirmAll(true)}
        >
          {tx('Regenerate all')}
        </Button>
        {canAdd && (
          <Button
            size="touch"
            leftSection={<IconUserPlus size={16} />}
            onClick={() => setAdding(true)}
          >
            {tx('Add player')}
          </Button>
        )}
      </Group>
      <MatchListFrame testId="codes-list">
        {entries.map(([id, p]) => (
          <Paper key={id} variant="row" p="sm" role="listitem" data-testid="code-row">
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Stack gap={2} miw={0}>
                <Group gap={6} wrap="wrap" align="center">
                  <Text fw={600}>{p.name}</Text>
                  {p.hub_account_linked && (
                    <Tooltip
                      label={tx('Has a Player Hub profile')}
                      withArrow
                      events={TOOLTIP_EVENTS}
                    >
                      <ThemeIcon
                        size="sm"
                        radius="xl"
                        variant="light"
                        color="court"
                        role="img"
                        aria-label={tx('Has a Player Hub profile')}
                        data-testid="hub-linked"
                      >
                        <IconUserCheck size={14} />
                      </ThemeIcon>
                    </Tooltip>
                  )}
                </Group>
                <Anchor
                  component="button"
                  type="button"
                  ff="monospace"
                  title={tx('Click to copy')}
                  onClick={() => void copy(p.passphrase, tx('Copied'))}
                >
                  {p.passphrase}
                </Anchor>
              </Stack>
              <Group gap={4} wrap="nowrap">
                {withdrawals && <WithdrawnStatus tid={tid} id={id} ctx={withdrawals} />}
                <ActionIcon
                  size="touch"
                  aria-label={`${tx('QR code')}: ${p.name}`}
                  onClick={() => setQrFor(id)}
                >
                  <IconQrcode size={20} />
                </ActionIcon>
                <ActionIcon
                  size="touch"
                  aria-label={`${tx('Share link')}: ${p.name}`}
                  onClick={() => void share(tid, p)}
                >
                  <IconShare size={20} />
                </ActionIcon>
                <ActionIcon
                  size="touch"
                  aria-label={`${tx('Regenerate')}: ${p.name}`}
                  loading={regenerate.isPending && regenerate.variables?.includes(id)}
                  onClick={() => regenerate.mutate([id])}
                >
                  <IconRefresh size={20} />
                </ActionIcon>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon size="touch" aria-label={`${tx('Player options')}: ${p.name}`}>
                      <IconDots size={20} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconAddressBook size={16} />}
                      onClick={() => setContactFor(id)}
                    >
                      {tx('Contact and email')}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconMail size={16} />}
                      disabled={!p.email}
                      onClick={() => sendOne.mutate(id)}
                    >
                      {tx('Email login link')}
                    </Menu.Item>
                    {user?.role === 'admin' && (
                      <Menu.Item
                        leftSection={<IconLink size={16} />}
                        onClick={() => setLinkFor(id)}
                      >
                        {tx('Player Hub profile')}
                        {p.profile_id ? ` · ${tx('Linked')}` : ''}
                      </Menu.Item>
                    )}
                    {withdrawals && canWithdrawEntry(id, withdrawals) && (
                      <>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconUserMinus size={16} />}
                          onClick={() => setWithdrawFor(id)}
                        >
                          {tx('Withdraw')}
                        </Menu.Item>
                      </>
                    )}
                    {canRemove && (
                      <>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => setRemoveFor(id)}
                        >
                          {tx('Remove from event')}
                        </Menu.Item>
                      </>
                    )}
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          </Paper>
        ))}
      </MatchListFrame>
      {adding && roster && (
        <AddPlayerDialog
          tid={tid}
          groups={roster.prefix === 'gp' ? roster.groups : []}
          onClose={() => setAdding(false)}
        />
      )}
      {removeFor && codes.data.players[removeFor] && (
        <RemovePlayerDialog
          tid={tid}
          playerId={removeFor}
          name={codes.data.players[removeFor].name}
          onClose={() => setRemoveFor(null)}
        />
      )}
      {contactFor && codes.data.players[contactFor] && (
        <ContactSheet
          tid={tid}
          playerId={contactFor}
          player={codes.data.players[contactFor]}
          onClose={() => setContactFor(null)}
        />
      )}
      {linkFor && codes.data.players[linkFor] && (
        <LinkProfileSheet
          tid={tid}
          playerId={linkFor}
          player={codes.data.players[linkFor]}
          onClose={() => setLinkFor(null)}
        />
      )}
      {withdrawFor && (
        <WithdrawDialog tid={tid} playerId={withdrawFor} onClose={() => setWithdrawFor(null)} />
      )}
      {qrFor && codes.data.players[qrFor] && (
        <QrDialog
          tid={tid}
          playerId={qrFor}
          player={codes.data.players[qrFor]}
          onClose={() => setQrFor(null)}
        />
      )}
      <Modal
        opened={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={tx('Regenerate all codes?')}
      >
        <Stack>
          <Text size="sm">
            {tx('Every printed code and QR stops working. Players must use the new ones.')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmAll(false)}>
              {tx('Cancel')}
            </Button>
            <Button
              color="red"
              loading={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(
                  entries.map(([id]) => id),
                  { onSuccess: () => setConfirmAll(false) },
                )
              }
            >
              {tx('Regenerate all')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      {cards && (
        <PrintSheet title={`${name} - ${tx('Player codes')}`} cards={cards} onDone={done} />
      )}
    </Stack>
  );
}
