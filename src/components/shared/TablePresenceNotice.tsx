import { UsersRound } from 'lucide-react';

/** Informational presence never locks ordering actions. */
export function TablePresenceNotice({ names, compact = false }: { names: readonly string[]; compact?: boolean }) {
  const people = [...new Set(names)];
  if (!people.length) return null;
  return <span role="status" title={`${people.join(', ')} também está nesta mesa. Combinem os lançamentos para evitar duplicidade.`}
    className={`flex min-w-0 items-start gap-1 text-amber-700 dark:text-amber-300 ${compact ? 'text-[10px] leading-tight' : 'text-[11px] leading-snug'}`}>
    <UsersRound size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 break-words">{people.join(', ')} também {people.length > 1 ? 'estão' : 'está'} nesta mesa{compact ? '' : ' · combinem os lançamentos'}</span>
  </span>;
}
