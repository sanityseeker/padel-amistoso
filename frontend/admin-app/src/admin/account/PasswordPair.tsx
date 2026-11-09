import { PasswordInput } from '@mantine/core';
import { t as tx } from '../../i18n';
import { MIN_PASSWORD, mismatchProblem, passwordProblem } from './shared';

// New password + confirmation with inline validation. Mantine's PasswordInput
// provides the show/hide toggle. Problems show once the field has been touched.
export function PasswordPair({
  label,
  password,
  confirm,
  touched,
  onPassword,
  onConfirm,
  onTouched,
  passwordRef,
  confirmRef,
}: {
  label?: string;
  password: string;
  confirm: string;
  touched: boolean;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  onTouched: () => void;
  passwordRef?: React.Ref<HTMLInputElement>;
  confirmRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <>
      <PasswordInput
        ref={passwordRef}
        label={label ?? tx('New password')}
        description={tx('At least {n} characters.', { n: MIN_PASSWORD })}
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => onPassword(e.currentTarget.value)}
        onBlur={onTouched}
        error={touched ? passwordProblem(password) || undefined : undefined}
      />
      <PasswordInput
        ref={confirmRef}
        label={tx('Confirm password')}
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => onConfirm(e.currentTarget.value)}
        error={mismatchProblem(password, confirm) || undefined}
      />
    </>
  );
}
