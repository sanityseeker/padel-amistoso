import '@mantine/charts/styles.css';
import { AreaChart } from '@mantine/charts';
import { Paper, Text } from '@mantine/core';

export interface EloPoint {
  match: string;
  elo: number;
  /** Rating change of this entry. */
  delta: number;
  /** Event name, or the adjustment label for a manual change. */
  title: string;
  /** "6-4, 6-3" (empty for a manual change). */
  score: string;
  /** "vs Ana & Luis" (empty for a manual change). */
  opponent: string;
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: EloPoint }[] }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <Paper px="md" py="xs" withBorder shadow="md" radius="md">
      <Text size="sm" fw={650}>
        {point.title}
      </Text>
      {point.opponent && <Text size="sm">{point.opponent}</Text>}
      {point.score && <Text size="sm">{point.score}</Text>}
      <Text size="sm" c={point.delta >= 0 ? 'success' : 'danger'} fw={650}>
        {point.elo} ({point.delta > 0 ? '+' : ''}
        {point.delta})
      </Text>
    </Paper>
  );
}

// Rating over time, oldest to newest. Lazy chunk (see PlayerSparkline). Hovering a point shows the
// event, the opponent, the score and the rating change.
export default function EloChart({ data, label }: { data: EloPoint[]; label: string }) {
  const values = data.map((d) => d.elo);
  return (
    <AreaChart
      h={240}
      data={data}
      dataKey="match"
      series={[{ name: 'elo', label: 'ELO', color: 'court.6' }]}
      curveType="monotone"
      withDots={data.length < 30}
      withXAxis={false}
      yAxisProps={{
        domain: [Math.floor(Math.min(...values) - 10), Math.ceil(Math.max(...values) + 10)],
      }}
      tooltipProps={{
        content: (props) => <Tip {...(props as unknown as Parameters<typeof Tip>[0])} />,
      }}
      gridAxis="y"
      tickLine="none"
      aria-label={label}
    />
  );
}
