import { ActionIcon, Menu } from '@mantine/core';
import {
  IconDots,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconLink,
  IconPin,
  IconTrash,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { openItem, useOpenItems } from '../switcher';
import { useItemActions } from '../switcher/actions';
import type { HubEvent } from './model';

// The row menu of the hub and the lobby list: open, pin, visibility, copy link, delete. Delete only
// asks; the page owns the confirmation dialog.
export function EventMenu({
  event,
  canDelete,
  busy,
  onToggleVisible,
  onDelete,
}: {
  event: HubEvent;
  canDelete: boolean;
  busy?: boolean;
  onToggleVisible: (event: HubEvent) => void;
  onDelete: (event: HubEvent) => void;
}) {
  useLocale();
  const navigate = useNavigate();
  const actions = useItemActions();
  const items = useOpenItems();
  const item = { id: event.id, kind: event.kind, name: event.name } as const;
  const pinned = items.find((i) => i.id === event.id && i.kind === event.kind)?.pinned;
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon aria-label={tx('Options for {name}', { name: event.name })}>
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          rightSection={<IconExternalLink size={14} aria-hidden />}
          onClick={() => navigate(event.path)}
        >
          {tx('Open')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconPin size={15} />}
          onClick={() => {
            openItem(item);
            actions.togglePin(item);
          }}
        >
          {pinned ? tx('Unpin') : tx('Pin')}
        </Menu.Item>
        <Menu.Item leftSection={<IconLink size={15} />} onClick={() => void actions.copyLink(item)}>
          {event.kind === 'lobby' ? tx('Copy registration link') : tx('Copy public link')}
        </Menu.Item>
        <Menu.Item
          disabled={busy}
          leftSection={event.listed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          onClick={() => onToggleVisible(event)}
        >
          {event.listed ? tx('Make private') : tx('Make public')}
        </Menu.Item>
        {canDelete && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={15} />}
              onClick={() => onDelete(event)}
            >
              {tx('Delete')}
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
