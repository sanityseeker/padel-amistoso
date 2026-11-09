import { sportProps } from '../../theme';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Box, Menu } from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconDeviceTv,
  IconExternalLink,
  IconPin,
  IconPinnedOff,
  IconX,
} from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { useItemActions } from './actions';
import { orderItems, useOpenItems, type OpenItem } from './openItems';

const LONG_PRESS_MS = 500;

// The item context menu. A controlled Menu anchored to the whole row: it opens on right-click, on a
// long press (touch and pen), on Shift+F10 / the Menu key, and from the "..." button the row renders
// through `children({ toggle })`. Delete is deliberately not here; it stays behind the confirmation
// in the workspace.
export function ItemMenu({
  item,
  name,
  children,
  className,
  active,
  sport,
}: {
  item: OpenItem;
  name: string;
  children: (menu: { toggle: () => void; opened: boolean }) => ReactNode;
  className?: string;
  active?: boolean;
  /** Scopes the sport accent (blue padel, green tennis) to the row. */
  sport?: string | null;
}) {
  useLocale();
  const [opened, setOpened] = useState(false);
  const press = useRef<{ timer?: number; fired: boolean }>({ fired: false });
  const actions = useItemActions();
  const items = useOpenItems();
  const pinned = orderItems(items).filter((i) => i.pinned);
  const pinIndex = pinned.findIndex((i) => i.id === item.id && i.kind === item.kind);
  const lobby = item.kind === 'lobby';

  const clearPress = () => window.clearTimeout(press.current.timer);
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      setOpened(true);
    }
  };
  const run = (fn: () => void) => () => {
    setOpened(false);
    fn();
  };
  return (
    <Menu
      opened={opened}
      // Mantine would toggle on a plain click of the target; only closing is accepted from it.
      // Opening comes from right-click, long press, Shift+F10 and the "..." button.
      onChange={(next) => {
        if (!next) setOpened(false);
      }}
      position="bottom-start"
      withinPortal
      width={230}
    >
      <Menu.Target>
        <Box
          className={className}
          data-active={active || undefined}
          {...sportProps(sport)}
          onContextMenu={(event) => {
            event.preventDefault();
            setOpened(true);
          }}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse') return;
            press.current.fired = false;
            clearPress();
            press.current.timer = window.setTimeout(() => {
              press.current.fired = true;
              setOpened(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={clearPress}
          onPointerMove={clearPress}
          onPointerCancel={clearPress}
          onClickCapture={(event) => {
            // The click that ends a long press must not also open the item.
            if (press.current.fired) {
              press.current.fired = false;
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {children({ toggle: () => setOpened((o) => !o), opened })}
        </Box>
      </Menu.Target>
      <Menu.Dropdown aria-label={tx('Options for {name}', { name })}>
        <Menu.Item leftSection={<IconCheck size={16} />} onClick={run(() => actions.open(item))}>
          {tx('Open page')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconExternalLink size={16} />}
          onClick={run(() => actions.openInNewTab(item))}
        >
          {tx('Open in new tab')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={item.pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}
          onClick={run(() => actions.togglePin(item))}
        >
          {item.pinned ? tx('Unpin') : tx('Pin')}
        </Menu.Item>
        {item.pinned && (
          <>
            <Menu.Item
              leftSection={<IconArrowUp size={16} />}
              disabled={pinIndex <= 0}
              onClick={run(() => actions.move(item, -1))}
            >
              {tx('Move up')}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconArrowDown size={16} />}
              disabled={pinIndex < 0 || pinIndex >= pinned.length - 1}
              onClick={run(() => actions.move(item, 1))}
            >
              {tx('Move down')}
            </Menu.Item>
          </>
        )}
        <Menu.Divider />
        {!lobby && (
          <Menu.Item component="a" href={`/tv/${item.id}`} leftSection={<IconDeviceTv size={16} />}>
            {tx('TV view')}
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<IconCopy size={16} />}
          onClick={run(() => void actions.copyLink(item))}
        >
          {lobby ? tx('Copy registration link') : tx('Copy public link')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<IconX size={16} />} onClick={run(() => actions.close(item))}>
          {tx('Close')}
        </Menu.Item>
        <Menu.Item onClick={run(() => actions.closeOthers(item))}>{tx('Close others')}</Menu.Item>
        <Menu.Item onClick={run(() => actions.closeFinished())}>
          {tx('Close all finished')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
