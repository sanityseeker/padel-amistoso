import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Table, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useLocale } from '../i18n';
import classes from './DataTable.module.css';

export interface DataColumn<R> {
  key: string;
  label: string;
  /** `num` right-aligns and sizes the column from `chars`. The first column is always text. */
  kind?: 'text' | 'num';
  cell: (row: R) => ReactNode;
  /** Container width in px the table needs before this column shows. Without it the column always shows. */
  minWidth?: number;
  /** Characters in the widest value (num columns). */
  chars?: number;
  /** Mantine color of the cell. */
  tone?: (row: R) => string | undefined;
  bold?: boolean;
  /** Full header text for a short label. */
  title?: string;
}

export interface DataTableProps<R> {
  columns: DataColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  /** The first column stays in view when the table scrolls sideways (default true). */
  sticky?: boolean;
  /** Extra content under the first cell, after the values of the hidden columns. */
  sub?: (row: R, hidden: DataColumn<R>[]) => ReactNode;
  density?: 'md' | 'compact';
  testId?: string;
  onRowClick?: (row: R) => void;
  /** Attributes for each row (for example `data-sport`). */
  rowProps?: (row: R) => Record<string, string | undefined>;
}

const longestWord = (label: string) => Math.max(...label.split(/\s+/).map((w) => w.length));

function textOf(node: ReactNode): string | undefined {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : undefined;
}

export function DataTable<R>({
  columns,
  rows,
  rowKey,
  sticky = true,
  sub,
  density = 'md',
  testId,
  onRowClick,
  rowProps,
}: DataTableProps<R>) {
  useLocale();
  const { ref: boxRef, width } = useElementSize<HTMLDivElement>();
  const tableRef = useRef<HTMLTableElement>(null);
  const [overflow, setOverflow] = useState(false);
  // Before the first measurement every column shows would flicker, so only the always-on ones do.
  const measured = width > 0;
  const shown = columns.filter(
    (c, i) => i === 0 || !c.minWidth || (measured && width >= c.minWidth),
  );
  const hidden = columns.filter((c, i) => i > 0 && !shown.includes(c));
  const shownKeys = shown.map((c) => c.key).join(' ');
  useEffect(() => {
    const table = tableRef.current;
    if (table && measured) setOverflow(table.offsetWidth > width + 1);
  }, [width, measured, shownKeys, rows]);
  const first = columns[0];
  if (!first) return null;
  const rest = shown.slice(1);
  return (
    <div
      ref={boxRef}
      className={classes.box}
      data-overflow={overflow || undefined}
      onScrollCapture={(e) => {
        const el = e.target as HTMLElement;
        if (el.scrollWidth > el.clientWidth)
          setOverflow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
      }}
    >
      <Table.ScrollContainer minWidth={0}>
        <Table
          ref={tableRef}
          className={classes.table}
          data-density={density}
          data-sticky={sticky || undefined}
          data-testid={testId}
          verticalSpacing="xs"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.first} title={first.title ?? first.label}>
                <span className={classes.head}>{first.label}</span>
              </Table.Th>
              {rest.map((c) => (
                <Table.Th
                  key={c.key}
                  data-num={c.kind === 'num' || undefined}
                  className={c.kind === 'num' ? classes.num : undefined}
                  style={{ '--chars': c.chars, '--head': longestWord(c.label) } as CSSProperties}
                  title={c.title ?? c.label}
                >
                  <span className={classes.head}>{c.label}</span>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const name = first.cell(r);
              const extra = sub?.(r, hidden);
              const hiddenCols = hidden.filter((c) => c.cell(r) != null);
              return (
                <Table.Tr
                  key={rowKey(r)}
                  className={classes.row}
                  data-click={onRowClick ? '' : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  {...rowProps?.(r)}
                >
                  <Table.Td className={classes.first}>
                    <div className={classes.name} title={textOf(name)}>
                      {name}
                    </div>
                    {(hiddenCols.length > 0 || extra) && (
                      <div className={classes.sub}>
                        {hiddenCols.map((c, i) => (
                          <Fragment key={c.key}>
                            {i > 0 && ' '}
                            <span className={classes.subItem}>
                              {c.label}{' '}
                              <Text span inherit c={c.tone?.(r)} fw={c.bold ? 600 : undefined}>
                                {c.cell(r)}
                              </Text>
                              {(i < hiddenCols.length - 1 || extra) && ' \u00b7'}
                            </span>
                          </Fragment>
                        ))}
                        {extra && hiddenCols.length > 0 && ' '}
                        {extra}
                      </div>
                    )}
                  </Table.Td>
                  {rest.map((c) => (
                    <Table.Td
                      key={c.key}
                      data-num={c.kind === 'num' || undefined}
                      className={c.kind === 'num' ? classes.num : undefined}
                      c={c.tone?.(r)}
                      fw={c.bold ? 600 : undefined}
                    >
                      {c.cell(r)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}
