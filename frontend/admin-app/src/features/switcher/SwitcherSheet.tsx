import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  NavLink,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { useTournamentList } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { BottomDrawer } from '../../ui';
import { useShellUi } from '../../shell/ShellUi';
import { useItemActions } from './actions';
import { EntryIcon, ReviewBadge, useIsActive } from './OpenTabs';
import { monogram, useEntryInfo, useOrderedItems, useSwitcherIndex } from './entries';
import { sportColor } from '../../theme';
import { ItemMenu } from './ItemMenu';
import { openPath, type OpenItem } from './openItems';
import { matchScore } from './search';
import classes from './Dock.module.css';

function PinnedCard({ item, onGo }: { item: OpenItem; onGo: () => void }) {
  const info = useEntryInfo(item);
  const active = useIsActive(info);
  return (
    <ItemMenu item={item} name={info.name} sport={info.sport}>
      {() => (
        <Card
          component={Link}
          to={info.path}
          padding="sm"
          className={classes.card}
          data-active={active || undefined}
          aria-label={info.name}
          aria-current={active ? 'page' : undefined}
          onClick={onGo}
        >
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <EntryIcon info={info} size={28} />
            <Stack gap={2} miw={0} flex={1}>
              <Text className={classes.label} fw={700}>
                {info.name}
              </Text>
              <Text className={classes.description}>{info.eyebrow}</Text>
            </Stack>
            <ReviewBadge count={info.review} />
          </Group>
          {info.progress != null && (
            <Progress
              value={Math.round(info.progress * 100)}
              size={2}
              color={sportColor(info.sport).mantine}
              mt="xs"
              aria-hidden
            />
          )}
        </Card>
      )}
    </ItemMenu>
  );
}

function RecentRow({ item, onGo }: { item: OpenItem; onGo: () => void }) {
  const info = useEntryInfo(item);
  const active = useIsActive(info);
  const actions = useItemActions();
  return (
    <ItemMenu item={item} name={info.name} sport={info.sport}>
      {() => (
        <Group gap={0} wrap="nowrap">
          <NavLink
            component={Link}
            to={info.path}
            active={active}
            aria-label={info.name}
            aria-current={active ? 'page' : undefined}
            label={info.name}
            description={info.eyebrow}
            classNames={{ label: classes.label, description: classes.description }}
            leftSection={<EntryIcon info={info} size={28} />}
            rightSection={<ReviewBadge count={info.review} />}
            onClick={onGo}
            style={{ flex: 1 }}
          />
          <ActionIcon
            size="lg"
            aria-label={tx('Close {name}', { name: info.name })}
            onClick={() => actions.close(item)}
          >
            <IconX size={16} />
          </ActionIcon>
        </Group>
      )}
    </ItemMenu>
  );
}

// Phone switcher: search, pinned cards, recents, and live events that are not open yet.
export function SwitcherSheet() {
  useLocale();
  const { switcherOpen, setSwitcherOpen } = useShellUi();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = useOrderedItems();
  const tournaments = useTournamentList(!!user);
  const [query, setQuery] = useState('');
  const activeId = pathname.match(/^\/admin\/t\/([^/]+)/)?.[1];
  const index = useSwitcherIndex(activeId);
  const close = () => {
    setSwitcherOpen(false);
    setQuery('');
  };
  const pinned = items.filter((i) => i.pinned);
  const recent = items.filter((i) => !i.pinned);
  const open = new Set(items.map((i) => i.id));
  const others = (tournaments.data ?? [])
    .filter((t) => t.phase !== 'finished' && !open.has(t.id))
    .slice(0, 8);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    return index
      .map((entry) => ({
        entry,
        score: matchScore(query, [entry.label, entry.description, ...entry.keywords], entry.id),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r) => r.entry);
  }, [index, query]);

  return (
    <BottomDrawer
      opened={switcherOpen}
      onClose={close}
      title={tx('Switch tournament')}
      minHeight="55dvh"
    >
      <Stack gap="md">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={tx('Search or jump...')}
          aria-label={tx('Search or jump...')}
          leftSection={<IconSearch size={17} />}
          rightSection={
            query ? (
              <IconX
                size={16}
                onClick={() => setQuery('')}
                style={{ cursor: 'pointer' }}
                aria-hidden
              />
            ) : undefined
          }
          size="md"
        />
        {query.trim() ? (
          results.length ? (
            <Stack gap={2}>
              {results.map((r) => (
                <NavLink
                  key={r.kind + r.id}
                  component={Link}
                  to={r.path}
                  label={r.label}
                  description={r.description}
                  onClick={close}
                />
              ))}
            </Stack>
          ) : (
            <Text c="dimmed" size="sm">
              {tx('Nothing matches.')}
            </Text>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <Stack gap="xs">
                <Text variant="eyebrow">{tx('Pinned')}</Text>
                <SimpleGrid cols={2} spacing="xs">
                  {pinned.map((item) => (
                    <PinnedCard key={item.kind + item.id} item={item} onGo={close} />
                  ))}
                </SimpleGrid>
              </Stack>
            )}
            {recent.length > 0 && (
              <Stack gap={2}>
                <Text variant="eyebrow">{tx('Recent')}</Text>
                {recent.map((item) => (
                  <RecentRow key={item.kind + item.id} item={item} onGo={close} />
                ))}
              </Stack>
            )}
            {!items.length && (
              <Text c="dimmed" size="sm">
                {tx('Open a tournament or lobby and it stays here for quick switching.')}
              </Text>
            )}
            {others.length > 0 && (
              <Stack gap={2}>
                <Text variant="eyebrow">{tx('Other live events')}</Text>
                {others.map((t) => (
                  <NavLink
                    key={t.id}
                    label={t.name}
                    description={t.owner}
                    leftSection={
                      <Badge size="sm" variant="light" circle>
                        {monogram(t.name).slice(0, 2)}
                      </Badge>
                    }
                    onClick={() => {
                      close();
                      navigate(openPath({ id: t.id, kind: 'tournament' }));
                    }}
                  />
                ))}
              </Stack>
            )}
          </>
        )}
      </Stack>
    </BottomDrawer>
  );
}
