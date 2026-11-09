import { Alert } from '@mantine/core';
import { t as tx } from '../i18n';

export function MutationError({ error }: { error: Error | null | undefined }) {
  return error ? <Alert color="red">{tx(error.message)}</Alert> : null;
}
