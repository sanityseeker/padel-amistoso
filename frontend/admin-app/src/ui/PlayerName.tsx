import { Fragment } from 'react';
import { UnstyledButton } from '@mantine/core';
import { t as tx } from '../i18n';
import classes from './PlayerName.module.css';

/** A player's name; with `onOpen` the whole name is a button that opens their card. */
export function PlayerName({ name, onOpen }: { name: string; onOpen?: () => void }) {
  if (!onOpen) return <>{name}</>;
  return (
    <UnstyledButton
      className={classes.name}
      data-testid="player-name"
      aria-label={tx('Open profile for {name}', { name })}
      onClick={(event) => {
        // A name inside a clickable row opens the card, not the row.
        event.stopPropagation();
        onOpen();
      }}
    >
      {name}
    </UnstyledButton>
  );
}

/** The names of one side. Each opens its own card when its id is known (ids line up with names). */
export function PlayerNames({
  names,
  ids,
  onPlayer,
  separator = ' & ',
}: {
  names: string[];
  ids?: string[];
  onPlayer?: (id: string, name: string) => void;
  separator?: string;
}) {
  const linked = !!onPlayer && !!ids && ids.length === names.length;
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={`${i}:${name}`}>
          {i > 0 && separator}
          <PlayerName name={name} onOpen={linked ? () => onPlayer!(ids![i]!, name) : undefined} />
        </Fragment>
      ))}
    </>
  );
}
