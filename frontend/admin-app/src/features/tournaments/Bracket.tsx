import { Loader, Paper, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import type { Match, TvSettings } from '../../types';
import { SchemaViewer } from '../../ui';
import { schemaQuery, useSchemaSvg } from '../../bracketSchema';
import { authHeaders } from '../../admin/tournament/authHeaders';

/** Espejo (`bracket_side`) and double elimination ("Losers ..." rounds) are drawn as two pictures. */
const hasLosersSide = (matches: Match[]) =>
  matches.some(
    (m) => m.bracket_side === 'losers' || /^\s*(losers?|lb)\b/i.test(m.round_label ?? ''),
  );

// The diagram is withheld from anonymous viewers while the schedule is hidden, so it loads with the
// organizer's token. It is placed in the page as an SVG, so it takes the app's colours and follows a
// theme switch.
function Diagram({ src, alt }: { src: string; alt: string }) {
  const { svg } = useSchemaSvg(src, authHeaders);
  if (!svg) return <Loader size="sm" aria-label={tx('Loading')} />;
  return <SchemaViewer markup={svg} label={alt} testId="bracket-diagram" />;
}

// The play-off bracket: the server-drawn picture (`/{prefix}/playoffs-schema`). Matches are scored in
// the Match centre.
export function Bracket({
  matches,
  settings,
  tid,
  prefix,
}: {
  matches: Match[];
  settings: TvSettings;
  tid: string;
  prefix: string;
}) {
  useLocale();
  if (!matches.length)
    return (
      <Paper variant="dashed" p="lg">
        <Text c="dimmed">{tx('The bracket appears once the play-offs start.')}</Text>
      </Paper>
    );
  const sides = hasLosersSide(matches) ? (['winners', 'losers'] as const) : [undefined];
  return (
    <Stack gap="md" data-testid="bracket">
      {sides.map((side) => (
        <Diagram
          key={side ?? 'main'}
          src={`/api/tournaments/${tid}/${prefix}/playoffs-schema?${schemaQuery(settings, side ? { side } : {})}`}
          alt={side === 'losers' ? tx('Losers', { context: 'bracket' }) : tx('Play-off bracket')}
        />
      ))}
    </Stack>
  );
}
