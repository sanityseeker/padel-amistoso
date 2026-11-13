import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { ResponsiveSheet } from '../../ui';
import { SchemaImage } from '../info/SchemaImage';
import type { BracketFormat } from './rules';

// A picture of the bracket before it exists (GET /api/schema/playoff-preview). Espejo shows the winners
// bracket with the real names and the consolation bracket with "Loser n" seeds, because the first-round
// losers are not known yet.
export function PlayoffPreview({
  names,
  format,
  winners,
  thirdPlace,
  title,
}: {
  names: string[];
  format: BracketFormat;
  winners: number;
  thirdPlace: boolean;
  title: string;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const url = (list: string[], heading: string, withWinners: boolean) => {
    const q = new URLSearchParams({
      participants: String(list.length),
      elimination: format === 'double' ? 'double' : 'single',
      fmt: 'png',
      output_scale: '0.7',
    });
    if (withWinners && winners > 1) q.set('num_winners', String(winners));
    if (withWinners && thirdPlace) q.set('third_place', 'true');
    if (heading) q.set('title', heading);
    for (const n of list) q.append('names', n);
    return `/api/schema/playoff-preview?${q}`;
  };
  const losers = Array.from({ length: Math.floor(names.length / 2) }, (_, i) =>
    tx('Loser {n}', { n: i + 1 }),
  );
  return (
    <>
      <Button
        variant="default"
        leftSection={<IconPhoto size={16} />}
        disabled={names.length < 2}
        onClick={() => setOpen(true)}
      >
        {tx('Preview bracket')}
      </Button>
      <ResponsiveSheet
        opened={open}
        onClose={() => setOpen(false)}
        title={tx('Bracket preview')}
        size="xl"
        fullHeight
      >
        {open && (
          <Stack gap="md">
            <SchemaImage
              url={url(names, format === 'espejo' ? tx('Winners bracket') : title.trim(), true)}
              filename="bracket"
              alt={tx('Bracket preview')}
              inlineZoom
            />
            {format === 'espejo' &&
              (losers.length >= 2 ? (
                <SchemaImage
                  url={url(losers, tx('Losers bracket'), false)}
                  filename="bracket-losers"
                  alt={tx('Losers bracket')}
                  inlineZoom
                />
              ) : (
                <Text size="sm" c="dimmed">
                  {tx('The losers bracket needs at least 2 first-round losers.')}
                </Text>
              ))}
          </Stack>
        )}
      </ResponsiveSheet>
    </>
  );
}
