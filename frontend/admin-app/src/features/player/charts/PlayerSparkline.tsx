import '@mantine/charts/styles.css';
import { Sparkline } from '@mantine/charts';

// Lazy chunk: @mantine/charts and recharts load only on the Hub and Ratings routes.
export default function PlayerSparkline({ data, label }: { data: number[]; label: string }) {
  // The chart's axis starts at 0, which flattens a rating moving around 1000. Plot the shape only.
  const min = Math.min(...data);
  const padding = (Math.max(...data) - min) * 0.1 || 1;
  const shape = data.map((value) => value - min + padding);
  return (
    <Sparkline
      aria-label={label}
      role="img"
      w="100%"
      h={56}
      data={shape}
      curveType="monotone"
      color="white"
      fillOpacity={0.15}
      strokeWidth={2}
    />
  );
}
