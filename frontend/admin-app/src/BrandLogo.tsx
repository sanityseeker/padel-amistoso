import { t as tx } from './i18n';

export function BrandLogo({ size = 44 }: { size?: number }) {
  return (
    <img
      src="/icon-192.png"
      alt={tx('Amistoso logo')}
      width={size}
      height={size}
      style={{
        display: 'block',
        flexShrink: 0,
        borderRadius: '50%',
        objectFit: 'contain',
        background: 'white',
      }}
    />
  );
}
