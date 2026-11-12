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

/** Round ticks around the values: a 1-2-5 step for about three gaps, the range snapped to it. */
function niceTicks(values: number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const raw = Math.max(hi - lo, 10) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= Math.ceil(hi / step) * step; t += step)
    ticks.push(t);
  return ticks;
}

// Rating over time, oldest to newest. Lazy chunk (see PlayerSparkline). Hovering a point shows the
// event, the opponent, the score and the rating change. Straight segments: the rating moves match by
// match, a smoothed curve would invent values between them. Round ticks, solid hairline grid.
export default function EloChart({ data, label }: { data: EloPoint[]; label: string }) {
  const ticks = niceTicks(data.map((d) => d.elo));
  const dot = {
    r: 4,
    strokeWidth: 2,
    stroke: 'var(--app-surface)',
    fill: 'var(--mantine-color-court-6)',
  };
  return (
    <AreaChart
      h={240}
      data={data}
      dataKey="match"
      series={[{ name: 'elo', label: 'ELO', color: 'court.6' }]}
      curveType="linear"
      strokeWidth={2}
      fillOpacity={0.12}
      withDots={data.length < 30}
      dotProps={dot}
      activeDotProps={{ ...dot, r: 5 }}
      withXAxis={false}
      yAxisProps={{
        domain: [ticks[0], ticks[ticks.length - 1]],
        ticks,
        interval: 0,
        width: 44,
      }}
      tooltipProps={{
        content: (props) => <Tip {...(props as unknown as Parameters<typeof Tip>[0])} />,
      }}
      gridAxis="x"
      strokeDasharray="0"
      tickLine="none"
      aria-label={label}
    />
  );
}
