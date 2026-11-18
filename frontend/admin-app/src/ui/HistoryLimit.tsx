import { SegmentedControl } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { HISTORY_SHORT, type HistoryLimitValue } from './historyLimit';

/**
 * The 10 / 25 / All choice next to a match history's heading. Shown only when the history has more
 * than 10 matches (`total`), so a short history stays free of controls.
 */
export function HistoryLimit({
  value,
  onChange,
  total,
}: {
  value: HistoryLimitValue;
  onChange: (value: HistoryLimitValue) => void;
  total: number;
}) {
  useLocale();
  if (total <= HISTORY_SHORT) return null;
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as HistoryLimitValue)}
      aria-label={tx('Matches shown')}
      data={[
        { value: '10', label: '10' },
        { value: '25', label: '25' },
        { value: 'all', label: tx('All') },
      ]}
      data-testid="history-limit"
    />
  );
}
