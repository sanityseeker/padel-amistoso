import { useEffect, useRef, type Ref } from 'react';
import { ActionIcon, Group, NumberInput } from '@mantine/core';
import { t as tx } from '../i18n';
import { IconMinus, IconPlus } from '@tabler/icons-react';
import classes from './ScoreStepper.module.css';

export interface ScoreStepperProps {
  /** Digits as typed. Empty string means "not entered". */
  value: string;
  onChange: (value: string) => void;
  label: string;
  testId: string;
  max?: number;
  autoFocus?: boolean;
  /** Value was filled in from the other side (Mexicano total): shown muted until edited. */
  auto?: boolean;
  enterKeyHint?: 'next' | 'done';
  inputRef?: Ref<HTMLInputElement>;
  withButtons?: boolean;
  /** Sets mode: a 56 px cell without minus/plus. */
  compact?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

const HOLD_DELAY = 400;
const HOLD_RATE = 90;

// Direct numeric entry: a large NumberInput with 48 px minus/plus buttons (hold to repeat). The
// buttons are out of the tab order so Tab goes input to input to Save.
export function ScoreStepper({
  value,
  onChange,
  label,
  testId,
  max = 99,
  autoFocus,
  auto,
  enterKeyHint = 'next',
  inputRef,
  compact,
  onKeyDown,
  withButtons = !compact,
}: ScoreStepperProps) {
  const current = useRef(value);
  current.current = value;
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(0, (Number(current.current) || 0) + delta));
    current.current = String(next);
    onChange(String(next));
  };
  const hold = (delta: number) => {
    step(delta);
    stop();
    timers.current.delay = window.setTimeout(() => {
      timers.current.repeat = window.setInterval(() => step(delta), HOLD_RATE);
    }, HOLD_DELAY);
  };
  const button = (delta: number, name: string, icon: React.ReactNode) => (
    <ActionIcon
      size="score"
      variant="default"
      radius="md"
      tabIndex={-1}
      aria-label={name}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        hold(delta);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={(e) => {
        // Keyboard activation (detail 0) has no pointer events.
        if (e.detail === 0) step(delta);
      }}
    >
      {icon}
    </ActionIcon>
  );
  return (
    <Group
      gap="xs"
      wrap="nowrap"
      align="center"
      className={compact ? classes.compactControl : classes.control}
    >
      {withButtons && button(-1, `${tx('Decrease')}: ${label}`, <IconMinus size={20} />)}
      <NumberInput
        ref={inputRef}
        aria-label={label}
        data-testid={testId}
        data-autofocus={autoFocus ? true : undefined}
        autoFocus={autoFocus}
        hideControls
        size={compact ? 'md' : 'lg'}
        inputMode="numeric"
        min={0}
        max={max}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="strict"
        enterKeyHint={enterKeyHint}
        placeholder="0"
        value={value}
        onChange={(v) => onChange(v === '' ? '' : String(v))}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
        classNames={{
          input: [classes.input, compact ? classes.compact : '', auto ? classes.auto : ''].join(
            ' ',
          ),
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      {withButtons && button(1, `${tx('Increase')}: ${label}`, <IconPlus size={20} />)}
    </Group>
  );
}
