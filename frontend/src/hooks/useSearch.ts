import { useMemo } from 'react';
import { normalizarTexto } from '@shared/validadores';

const normalize = normalizarTexto;

export function useSearch<T>(items: T[], searchTerm: string, selector: (item: T) => Array<string | undefined | null>) {
  return useMemo(() => {
    const query = normalize(searchTerm);
    if (!query) return items;

    return items.filter((item) => selector(item).some((field) => normalize(String(field || '')).includes(query)));
  }, [items, searchTerm, selector]);
}
