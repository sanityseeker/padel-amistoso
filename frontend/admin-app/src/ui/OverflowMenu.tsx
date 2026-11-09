import type { ReactNode } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { IconDots } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

export interface OverflowItem {
  key: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  to?: string;
  href?: string;
  color?: string;
  /** Draws a divider before the item. */
  divider?: boolean;
  hidden?: boolean;
  /** A non-interactive heading before the item; it does not count as an item. */
  heading?: string;
}

/** A "more" menu that collapses to a single icon button when only one action is left. */
export function OverflowMenu({
  label,
  icon,
  items,
  size = 'lg',
}: {
  label: string;
  icon?: ReactNode;
  items: OverflowItem[];
  size?: string;
}) {
  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  if (shown.length === 1) {
    const [item] = shown;
    const props = {
      size,
      color: item.color,
      'aria-label': item.label,
      title: item.label,
      onClick: item.onClick,
    };
    if (item.to)
      return (
        <ActionIcon component={Link} to={item.to} {...props}>
          {item.icon}
        </ActionIcon>
      );
    if (item.href)
      return (
        <ActionIcon component="a" href={item.href} {...props}>
          {item.icon}
        </ActionIcon>
      );
    return <ActionIcon {...props}>{item.icon}</ActionIcon>;
  }
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon size={size} aria-label={label}>
          {icon ?? <IconDots size={18} />}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {shown.map((item) => (
          <div key={item.key}>
            {item.divider && <Menu.Divider />}
            {item.heading && <Menu.Label>{item.heading}</Menu.Label>}
            {item.to ? (
              <Menu.Item
                component={Link}
                to={item.to}
                color={item.color}
                leftSection={item.icon}
                onClick={item.onClick}
              >
                {item.label}
              </Menu.Item>
            ) : item.href ? (
              <Menu.Item
                component="a"
                href={item.href}
                color={item.color}
                leftSection={item.icon}
                onClick={item.onClick}
              >
                {item.label}
              </Menu.Item>
            ) : (
              <Menu.Item color={item.color} leftSection={item.icon} onClick={item.onClick}>
                {item.label}
              </Menu.Item>
            )}
          </div>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
