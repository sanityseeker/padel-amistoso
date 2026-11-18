import { Fragment, createContext, useContext, useMemo, type ReactNode } from 'react';
import { UnstyledButton } from '@mantine/core';
import { t as tx } from '../i18n';
import classes from './PlayerName.module.css';

const NO_IDS: ReadonlySet<string> = new Set();
const SelfIdsContext = createContext<ReadonlySet<string>>(NO_IDS);

/** The ids that are the viewer (profile id, event player ids, team ids). Their names are plain text, not
    links. Providers nest and add to the ids of the parent. Outside any provider nobody is the viewer. */
export function SelfIdsProvider({
  ids,
  children,
}: {
  ids: readonly (string | null | undefined)[];
  children: ReactNode;
}) {
  const parent = useContext(SelfIdsContext);
  const key = ids.filter(Boolean).join('|');
  const merged = useMemo(() => {
    const next = new Set(parent);
    for (const id of key ? key.split('|') : []) next.add(id);
    return next;
  }, [parent, key]);
  return <SelfIdsContext.Provider value={merged}>{children}</SelfIdsContext.Provider>;
}

export const useSelfIds = (): ReadonlySet<string> => useContext(SelfIdsContext);

/** A player's name; with `onOpen` the whole name is a button that opens their card, unless `id` is the viewer. */
export function PlayerName({
  name,
  id,
  onOpen,
}: {
  name: string;
  id?: string;
  onOpen?: () => void;
}) {
  const self = useSelfIds();
  if (!onOpen || (id !== undefined && self.has(id))) return <>{name}</>;
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
          <PlayerName
            name={name}
            id={ids?.[i]}
            onOpen={linked ? () => onPlayer!(ids![i]!, name) : undefined}
          />
        </Fragment>
      ))}
    </>
  );
}
