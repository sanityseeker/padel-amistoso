import { useEffect, useId, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  HoverCard,
  Kbd,
  Menu,
  Stack,
  Stepper,
  Text,
  ThemeIcon,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import {
  IconChevronDown,
  IconCopy,
  IconDeviceTv,
  IconDots,
  IconPinFilled,
  IconTrophy,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { sportColor } from '../../theme';
import { SportMark } from '../../ui';
import { useItemActions } from './actions';
import {
  entryDescription,
  useEntryInfo,
  useOrderedItems,
  usePrefetch,
  type EntryInfo,
} from './entries';
import { modifierLabel } from './hotkeys';
import { ItemMenu } from './ItemMenu';
import { type OpenItem } from './openItems';
import dockClasses from './Dock.module.css';
import classes from './OpenTabs.module.css';

export const OPEN_TABS_HEIGHT = 40;

export function useIsActive(info: EntryInfo) {
  const { pathname } = useLocation();
  return pathname === info.path;
}

/** Sport swatch icon: blue for padel, green for tennis. The state is the text beside it. */
export function EntryIcon({ info, size = 30 }: { info: EntryInfo; size?: number }) {
  return (
    <ThemeIcon
      size={size}
      radius="sm"
      variant="light"
      color={sportColor(info.sport).mantine}
      aria-hidden
    >
      {info.item.kind === 'lobby' ? <IconUsersGroup size={17} /> : <IconTrophy size={17} />}
    </ThemeIcon>
  );
}

export function ReviewBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Badge size="sm" circle color="red" aria-hidden>
      {count}
    </Badge>
  );
}

const STEPS: Record<string, string[]> = {
  mexicano: ['Mexicano', 'Finished'],
  group_playoff: ['Group stage', 'Play-offs', 'Finished'],
  playoff: ['Play-offs', 'Finished'],
};

/** Hover card: phase, matches done, courts, the slot shortcut and the three quick links. */
function Preview({ info, slot }: { info: EntryInfo; slot: number }) {
  const actions = useItemActions();
  const steps = info.type ? STEPS[info.type] : null;
  const active = info.finished
    ? (steps?.length ?? 0)
    : info.type === 'group_playoff' && info.phase === 'playoffs'
      ? 1
      : 0;
  const lobby = info.item.kind === 'lobby';
  return (
    <Stack gap="sm" className={dockClasses.preview}>
      <div>
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
          <Text className={dockClasses.previewName}>{info.name}</Text>
          {slot <= 8 && <Kbd size="xs">{`${modifierLabel()}+${slot}`}</Kbd>}
        </Group>
        <Text variant="eyebrow" mt={2}>
          {info.eyebrow}
        </Text>
      </div>
      {steps && (
        <Stepper active={active} size="xs" iconSize={18} wrap={false} allowNextStepsSelect={false}>
          {steps.map((label) => (
            <Stepper.Step key={label} label={tx(label)} />
          ))}
        </Stepper>
      )}
      <Group gap="md">
        {info.sport && <SportMark sport={info.sport} size="xs" />}
        {info.played != null && info.total != null && (
          <Text size="xs">
            {tx('{done} of {total} matches played', { done: info.played, total: info.total })}
          </Text>
        )}
        {info.courts != null && <Text size="xs">{tx('{n} courts', { n: info.courts })}</Text>}
      </Group>
      <Group gap="xs">
        <Button component={Link} to={info.path} size="compact-sm">
          {tx('Open page')}
        </Button>
        {!lobby && (
          <Button
            component="a"
            href={`/tv/${info.item.id}`}
            size="compact-sm"
            variant="default"
            leftSection={<IconDeviceTv size={14} />}
          >
            {tx('TV view')}
          </Button>
        )}
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconCopy size={14} />}
          onClick={() => void actions.copyLink(info.item)}
        >
          {tx('Copy link')}
        </Button>
      </Group>
    </Stack>
  );
}

/** One open tournament or lobby: name, review count, close, and the same menu everywhere. */
function OpenTab({ item, slot }: { item: OpenItem; slot: number }) {
  useLocale();
  const info = useEntryInfo(item);
  const active = useIsActive(info);
  const prefetch = usePrefetch();
  const actions = useItemActions();
  const descId = useId();
  const link = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (active) link.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const KindIcon = item.pinned
    ? IconPinFilled
    : item.kind === 'lobby'
      ? IconUsersGroup
      : IconTrophy;
  return (
    <ItemMenu
      item={item}
      name={info.name}
      className={classes.tab}
      active={active}
      sport={info.sport}
    >
      {({ toggle }) => (
        <>
          <HoverCard
            openDelay={500}
            closeDelay={100}
            position="bottom-start"
            withArrow={false}
            shadow="md"
            withinPortal
          >
            <HoverCard.Target>
              <UnstyledButton
                ref={link}
                component={Link}
                to={info.path}
                className={classes.link}
                aria-label={info.name}
                aria-describedby={descId}
                aria-current={active ? 'page' : undefined}
                onMouseEnter={() => prefetch(item)}
                onFocus={() => prefetch(item)}
              >
                <KindIcon size={15} className={classes.icon} aria-hidden />
                <span className={classes.name}>{info.name}</span>
                <ReviewBadge count={info.review} />
              </UnstyledButton>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Preview info={info} slot={slot} />
            </HoverCard.Dropdown>
          </HoverCard>
          <div className={classes.actions}>
            <div className={classes.more}>
              <ActionIcon
                size="sm"
                aria-label={tx('Options for {name}', { name: info.name })}
                onClick={toggle}
              >
                <IconDots size={15} />
              </ActionIcon>
            </div>
            <ActionIcon
              size="sm"
              className={classes.close}
              aria-label={tx('Close {name}', { name: info.name })}
              onClick={() => actions.close(item)}
            >
              <IconX size={14} />
            </ActionIcon>
          </div>
          <VisuallyHidden id={descId}>
            {[entryDescription(info), item.pinned && tx('Pinned')].filter(Boolean).join('. ')}
          </VisuallyHidden>
        </>
      )}
    </ItemMenu>
  );
}

function OverflowEntry({ item }: { item: OpenItem }) {
  const info = useEntryInfo(item);
  const active = useIsActive(info);
  return (
    <Menu.Item
      component={Link}
      to={info.path}
      aria-current={active ? 'page' : undefined}
      fw={active ? 700 : 400}
    >
      {info.name}
    </Menu.Item>
  );
}

// The open tournaments and lobbies as a row of tabs under the top bar, on tablet and desktop, so every
// name stays readable and one click away on any admin page. Pinned tabs lead. When the row no longer
// fits it scrolls, and a menu at the end lists everything.
export function OpenTabs() {
  useLocale();
  const items = useOrderedItems();
  const scroller = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  return (
    <nav aria-label={tx('Open tournaments')} className={classes.strip}>
      <div ref={scroller} className={classes.scroller}>
        {items.map((item, index) => (
          <OpenTab key={item.kind + item.id} item={item} slot={index + 1} />
        ))}
      </div>
      {overflowing && (
        <Menu position="bottom-end" withinPortal width={280}>
          <Menu.Target>
            <ActionIcon size="md" className={classes.all} aria-label={tx('All open tournaments')}>
              <IconChevronDown size={17} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {items.map((item) => (
              <OverflowEntry key={item.kind + item.id} item={item} />
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </nav>
  );
}
