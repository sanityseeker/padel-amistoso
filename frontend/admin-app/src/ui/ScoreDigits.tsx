import { useEffect, useRef, useState } from 'react';
import { Text } from '@mantine/core';
import classes from './ScoreDigits.module.css';

export interface ScoreDigitsProps {
  /** Single total (points mode). Ignored when `games` is given. */
  score?: number | null;
  /** Games per set (sets mode), one digit group per set. */
  games?: number[] | null;
  /** Marks a set as the match tie-break (rendered fainter, carries the `is-tb` hook). */
  isTiebreak?: (setIndex: number) => boolean;
  win?: boolean;
  size?: 'md' | 'tv';
}

// Scoreboard numerals: Geologica with tabular figures. A changed value rolls in once.
export function ScoreDigits({ score, games, isTiebreak, win, size = 'md' }: ScoreDigitsProps) {
  const previous = useRef(score);
  const [rolling, setRolling] = useState(false);
  useEffect(() => {
    if (previous.current !== score && previous.current !== undefined) setRolling(true);
    previous.current = score;
  }, [score]);
  const digit = (value: number | string, key: number, tb = false) => (
    <Text
      key={key}
      span
      variant="score"
      data-win={win ? '' : undefined}
      className={[classes.digit, tb ? `${classes.tb} is-tb` : '', rolling ? classes.roll : '']
        .filter(Boolean)
        .join(' ')}
      onAnimationEnd={() => setRolling(false)}
    >
      {value}
    </Text>
  );
  return (
    <span className={classes.digits} data-size={size}>
      {games ? games.map((g, i) => digit(g, i, isTiebreak?.(i))) : digit(score ?? '–', 0)}
    </span>
  );
}
