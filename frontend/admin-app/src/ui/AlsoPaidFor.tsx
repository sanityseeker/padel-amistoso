import { MultiSelect } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';

export interface PayableTeammate {
  player_id: string;
  player_name: string;
}

// "I also paid for": the other players of the same event whose payment is still open. Shown only
// when there is someone to pick; the server checks every id again.
export function AlsoPaidFor({
  players,
  value,
  onChange,
}: {
  players: PayableTeammate[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  useLocale();
  if (!players.length) return null;
  return (
    <MultiSelect
      label={tx('Also paid for')}
      placeholder={tx('Choose players')}
      description={tx('Their payment is reported too. The organizer confirms each one.')}
      searchable
      clearable
      nothingFoundMessage={tx('No players found')}
      data={players.map((p) => ({ value: p.player_id, label: p.player_name }))}
      value={value}
      onChange={onChange}
    />
  );
}
