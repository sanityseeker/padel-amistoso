import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { t as tx } from './i18n';

interface Options<V, R> {
  request: (variables: V) => Promise<R>;
  /** Query keys (prefixes) refreshed after success. */
  invalidate?: QueryKey[];
  /** Toast text on success (already translated or an English key). */
  success?: string | ((result: R, variables: V) => string);
  onSuccess?: (result: R, variables: V) => void;
}

// One wrapper for "call the admin API, refresh the lists, say it worked". The request itself still
// goes through `write()`/`api()` so the method, path, payload and admin token are unchanged.
export function useAdminMutation<V = void, R = unknown>({
  request,
  invalidate = [],
  success,
  onSuccess,
}: Options<V, R>) {
  const client = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: request,
    onSuccess: (result, variables) => {
      for (const queryKey of invalidate) void client.invalidateQueries({ queryKey });
      const message = typeof success === 'function' ? success(result, variables) : success;
      if (message) notifications.show({ message: tx(message), color: 'green' });
      onSuccess?.(result, variables);
    },
  });
}
