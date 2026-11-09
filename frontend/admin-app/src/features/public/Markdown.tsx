import { Fragment, type ReactNode } from 'react';
import { Anchor, List, Stack, Text, Title } from '@mantine/core';

// The organizer's description and message are Markdown. This renderer builds React elements only
// (never HTML), so nothing the organizer types can inject markup or script. It covers what the
// legacy page showed: headings, paragraphs, bullet and numbered lists, bold, italic, code, links.
const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /\*\*(.+?)\*\*|(?<!\w)__(.+?)__(?!\w)|\*(.+?)\*|(?<!\w)_(.+?)_(?!\w)|`(.+?)`|\[(.+?)\]\((.+?)\)|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, b1, b2, i1, i2, code, label, href, bare] = m;
    if (b1 || b2) out.push(<strong key={key++}>{inline(b1 || b2)}</strong>);
    else if (i1 || i2) out.push(<em key={key++}>{inline(i1 || i2)}</em>);
    else if (code) out.push(<code key={key++}>{code}</code>);
    else {
      const url = (href || bare || '').trim();
      out.push(
        SAFE_URL.test(url) ? (
          <Anchor key={key++} href={url} target="_blank" rel="noopener noreferrer">
            {label || url}
          </Anchor>
        ) : (
          (label ?? url)
        ),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <Title key={key++} order={Math.min(6, heading[1].length + 2) as 3 | 4 | 5 | 6}>
          {inline(heading[2])}
        </Title>,
      );
      i++;
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    const kind = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
    if (kind) {
      const items: string[] = [];
      while (i < lines.length && kind.test(lines[i])) items.push(lines[i++].replace(kind, ''));
      blocks.push(
        <List key={key++} type={kind === numbered ? 'ordered' : 'unordered'} size="sm">
          {items.map((item, n) => (
            <List.Item key={n}>{inline(item)}</List.Item>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push(
      <Text key={key++} size="sm">
        {para.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </Text>,
    );
  }
  return <Stack gap="xs">{blocks}</Stack>;
}
