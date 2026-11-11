import { Notice } from './Notice';
import { t as tx } from '../i18n';

export function MutationError({ error }: { error: Error | null | undefined }) {
  return error ? <Notice tone="danger">{tx(error.message)}</Notice> : null;
}
