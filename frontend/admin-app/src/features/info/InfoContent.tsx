import { Box, Text, Title, Typography } from '@mantine/core';
import { currentLanguage, useLocale } from '../../i18n';
import { CATALOG, catalogFor, type InfoItem, type InfoPara, type InfoSection } from './catalog';

// Draws the body of one guide section: intro paragraphs, then one sub-heading per item.
// The text is a static first-party catalog (catalog.ts), never user input, so HTML entries
// (<p>, <ul>, <strong>, <em>, <code>, <a>) render as they are inside Mantine's Typography.
export function InfoContent({ section, demo = false }: { section: InfoSection; demo?: boolean }) {
  useLocale();
  const words = catalogFor(currentLanguage());
  const text = (key: string) => words[key] ?? CATALOG.en[key] ?? key;
  const para = (p: InfoPara) => {
    // The sandbox paragraph has a variant for the demo instance (no clubs or communities there).
    if (p.key === 'txt_txt_info_demo_sandbox_desc' && demo) return null;
    if (p.key === 'txt_txt_info_demo_sandbox_desc_instance' && !demo) return null;
    return p.html ? (
      <Box key={p.key} dangerouslySetInnerHTML={{ __html: text(p.key) }} />
    ) : (
      <Text key={p.key}>{text(p.key)}</Text>
    );
  };
  const item = (i: InfoItem) => (
    <div key={i.title}>
      <Title order={3} mt="md" mb="xs">
        {text(i.title)}
      </Title>
      {i.paras.map(para)}
    </div>
  );
  return (
    <Typography>
      {section.intro.map(para)}
      {section.items.map(item)}
    </Typography>
  );
}
