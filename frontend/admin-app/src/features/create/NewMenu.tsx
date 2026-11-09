import { ActionIcon, Button, Tooltip } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { NEW_TOURNAMENT_HREF } from '../switcher/destinations';

// The one place the admin starts something new. It goes straight to the create form, where the
// format row (tournament formats or Lobby) is the choice. `rail` is the icon-only version for the
// narrow dock.
export function NewMenu({ rail }: { rail: boolean }) {
  useLocale();
  if (rail)
    return (
      <Tooltip label={tx('New')} position="right" openDelay={300}>
        <ActionIcon
          component={Link}
          to={NEW_TOURNAMENT_HREF}
          size="xl"
          variant="filled"
          radius="md"
          aria-label={tx('New')}
        >
          <IconPlus size={22} />
        </ActionIcon>
      </Tooltip>
    );
  return (
    <Button
      component={Link}
      to={NEW_TOURNAMENT_HREF}
      fullWidth
      leftSection={<IconPlus size={18} />}
      aria-label={tx('New')}
    >
      {tx('New')}
    </Button>
  );
}
