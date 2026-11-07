import { NativeSelect } from '@mantine/core';
import { IconLanguage } from '@tabler/icons-react';
import { i18n, t as tx, useLocale } from './i18n';
export function LanguageSelect() {
  useLocale();
  return (
    <NativeSelect
      aria-label={tx('Language')}
      title={tx('Language')}
      value={i18n.language === 'es' ? 'es' : 'en'}
      onChange={(event) => void i18n.changeLanguage(event.currentTarget.value)}
      data={[
        {
          value: 'en',
          label: 'EN',
        },
        {
          value: 'es',
          label: 'ES',
        },
      ]}
      leftSection={<IconLanguage size={17} />}
      className="language-select"
      w={{ base: 64, sm: 96 }}
      size="sm"
    />
  );
}
