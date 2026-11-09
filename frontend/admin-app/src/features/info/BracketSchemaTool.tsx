import { useMemo, useState } from 'react';
import {
  Accordion,
  Button,
  Chip,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPhoto } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { SchemaImage, type SchemaFormat } from './SchemaImage';

const PRESETS = [
  { label: '2×4', groups: '4,4', advance: 2 },
  { label: '3×4', groups: '4,4,4', advance: 2 },
  { label: '4×4', groups: '4,4,4,4', advance: 2 },
  { label: '2×6', groups: '6,6', advance: 3 },
  { label: '3×6', groups: '6,6,6', advance: 2 },
  { label: '4×6', groups: '6,6,6,6', advance: 2 },
];
const RENDER_DEFAULTS = { box: 1, line: 1, arrow: 1, header: 1, output: 0.7 };

// "Tournament bracket schema": draw the structure of a group stage and its play-off before creating an
// event (GET /api/schema/preview, anonymous). PNG, SVG or PDF, with the same rendering knobs the TV uses.
export function BracketSchemaTool() {
  useLocale();
  const [groups, setGroups] = useState('4,4');
  const [advance, setAdvance] = useState<number | string>(2);
  const [elimination, setElimination] = useState<string>('single');
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<SchemaFormat>('png');
  const [render, setRender] = useState(RENDER_DEFAULTS);
  const [url, setUrl] = useState<string | null>(null);

  const sizes = useMemo(
    () =>
      groups
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n) && n > 0),
    [groups],
  );
  const adv = Number(advance) || 0;
  const valid = sizes.length > 0 && sizes.every((n) => n >= 2) && adv >= 1;
  const preset = PRESETS.find((p) => p.groups === sizes.join(',') && p.advance === adv);
  const summary = (() => {
    if (!valid) return '';
    const same = sizes.every((n) => n === sizes[0]);
    return `${same ? `${sizes.length} × ${sizes[0]}` : sizes.join('+')} = ${tx('{n} players', {
      n: sizes.reduce((a, b) => a + b, 0),
    })} · ${tx('{n} qualify', { n: sizes.length * adv })} → ${
      elimination === 'double' ? tx('Double elimination') : tx('Single elimination')
    }`;
  })();
  const generate = () => {
    const q = new URLSearchParams({
      group_sizes: sizes.join(','),
      advance_per_group: String(adv),
      elimination,
      fmt: format,
      box_scale: String(render.box),
      line_width: String(render.line),
      arrow_scale: String(render.arrow),
      title_font_scale: String(render.header),
      output_scale: String(render.output),
    });
    if (title.trim()) q.set('title', title.trim());
    setUrl(`/api/schema/preview?${q}`);
  };
  const slider = (key: keyof typeof RENDER_DEFAULTS, label: string, min: number, max: number) => (
    <div key={key}>
      <Text size="sm">
        {label}: <b>{render[key].toFixed(1)}</b>
      </Text>
      <Slider
        min={min}
        max={max}
        step={0.1}
        label={null}
        aria-label={label}
        value={render[key]}
        onChange={(v) => setRender({ ...render, [key]: v })}
      />
    </div>
  );
  return (
    <Paper p="md" data-testid="schema-tool">
      <Stack gap="md">
        <Group gap="xs" role="group" aria-label={tx('Presets')}>
          {PRESETS.map((p) => (
            <Chip
              key={p.label}
              checked={preset?.label === p.label}
              onChange={() => {
                setGroups(p.groups);
                setAdvance(p.advance);
                setRender(RENDER_DEFAULTS);
              }}
            >
              {p.label}
            </Chip>
          ))}
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label={tx('Group sizes')}
            description={tx('Comma-separated, for example 4,4,4')}
            value={groups}
            onChange={(e) => setGroups(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && generate()}
            error={
              sizes.some((n) => n < 2) ? tx('Each group needs at least 2 players.') : undefined
            }
          />
          <NumberInput
            label={tx('Advance per group')}
            min={1}
            max={8}
            allowDecimal={false}
            value={advance}
            onChange={setAdvance}
          />
          <Select
            label={tx('Elimination')}
            allowDeselect={false}
            data={[
              { value: 'single', label: tx('Single elimination') },
              { value: 'double', label: tx('Double elimination') },
            ]}
            value={elimination}
            onChange={(v) => setElimination(v ?? 'single')}
          />
          <Select
            label={tx('Format')}
            allowDeselect={false}
            data={['png', 'svg', 'pdf'].map((f) => ({ value: f, label: f.toUpperCase() }))}
            value={format}
            onChange={(v) => setFormat((v as SchemaFormat) ?? 'png')}
          />
        </SimpleGrid>
        <TextInput
          label={tx('Title (optional)')}
          placeholder={tx('My Tournament')}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        {summary && (
          <Text size="sm" fw={600} aria-live="polite">
            {summary}
          </Text>
        )}
        <Accordion variant="contained" radius="lg">
          <Accordion.Item value="render">
            <Accordion.Control>{tx('Rendering options')}</Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {slider('box', tx('Box size'), 0.3, 3)}
                {slider('line', tx('Line width'), 0.3, 5)}
                {slider('arrow', tx('Arrow size'), 0.3, 5)}
                {slider('header', tx('Header size'), 0.3, 3)}
                {slider('output', tx('Output scale'), 0.5, 3)}
              </SimpleGrid>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        <Group>
          <Button leftSection={<IconPhoto size={16} />} disabled={!valid} onClick={generate}>
            {tx('Generate schema')}
          </Button>
        </Group>
        <SchemaImage
          url={url}
          format={format}
          filename={title.trim() || 'bracket'}
          alt={tx('Bracket')}
        />
      </Stack>
    </Paper>
  );
}
