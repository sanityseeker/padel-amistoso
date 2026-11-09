import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Switch } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import {
  bracketImages,
  buildReport,
  downloadHtml,
  loadExportOptions,
  printHtml,
  saveExportOptions,
  type ExportOptions,
} from './exportReport';
import { allMatches, type TournamentPageData } from './scoring';

// HTML download or printable PDF of the tournament as the workspace shows it. The choices are
// remembered per browser, as in the legacy export.
export function ExportDialog({
  tid,
  name,
  prefix,
  onClose,
}: {
  tid: string;
  name: string;
  prefix: string;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const [options, setOptions] = useState<ExportOptions>(loadExportOptions);
  const [busy, setBusy] = useState<'html' | 'pdf' | null>(null);
  const [error, setError] = useState('');
  const page = client.getQueryData<TournamentPageData>(['admin', 'tournament', tid]);
  const hasBracket = !!page && !page.groupStage && page.path === 'playoffs';
  const set = (key: keyof ExportOptions) => (checked: boolean) => {
    const next = { ...options, [key]: checked };
    setOptions(next);
    saveExportOptions(next);
  };
  const run = async (format: 'html' | 'pdf') => {
    if (!page) return;
    // The print window opens now, while the click still counts as a user gesture.
    const win = format === 'pdf' ? window.open('', '_blank') : null;
    if (format === 'pdf' && !win) {
      setError(tx('Pop-ups are blocked. Allow pop-ups to export a PDF.'));
      return;
    }
    setBusy(format);
    setError('');
    try {
      const images =
        options.bracket && hasBracket
          ? await bracketImages(
              tid,
              prefix,
              !!page.status.espejo || !!page.status.double_elimination,
            )
          : [];
      const report = buildReport({
        name,
        page,
        matches: allMatches(page.data),
        options,
        images,
        now: new Date(),
      });
      if (format === 'pdf' && win) printHtml(win, report.html);
      else downloadHtml(report.filename, report.html);
      onClose();
    } catch (e) {
      win?.close();
      setError(tx('Export failed: {value}', { value: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };
  const finished = page?.status.phase === 'finished';
  return (
    <Modal opened onClose={onClose} title={tx('Export results')} centered>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <Switch
          label={tx('Include match history')}
          checked={options.history}
          onChange={(e) => set('history')(e.currentTarget.checked)}
        />
        {hasBracket && (
          <Switch
            label={tx('Include the bracket diagram')}
            checked={options.bracket}
            onChange={(e) => set('bracket')(e.currentTarget.checked)}
          />
        )}
        {!finished && (
          <Switch
            label={tx('Include upcoming matches')}
            checked={options.upcoming}
            onChange={(e) => set('upcoming')(e.currentTarget.checked)}
          />
        )}
        <Switch
          label={tx('Include match comments')}
          checked={options.comments}
          onChange={(e) => set('comments')(e.currentTarget.checked)}
        />
        <Switch
          label={tx('Include ELO in standings')}
          checked={options.elo}
          onChange={(e) => set('elo')(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" size="touch" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button
            variant="light"
            size="touch"
            loading={busy === 'pdf'}
            onClick={() => void run('pdf')}
          >
            {tx('Export PDF')}
          </Button>
          <Button size="touch" loading={busy === 'html'} onClick={() => void run('html')}>
            {tx('Export HTML')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
