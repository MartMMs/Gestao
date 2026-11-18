// Grupos de categoria sem tabela nova: a categoria do serviço guarda "Grupo › Nome" no campo de texto que já existe.
// shortcut: renomear um grupo exige editar cada serviço dele; se a casa precisar disso, criar a tabela de categorias.
export const SEPARADOR_GRUPO = ' › ';
export const GRUPO_PADRAO = 'Geral';
export const LIMITE_CATEGORIA = 60;

export const montarCategoria = (grupo: string, nome: string) => {
  const limpar = (t: string) => t.replace(/›/g, ' ').replace(/\s+/g, ' ').trim();
  const g = limpar(grupo);
  const n = limpar(nome);
  // Sem nome não há categoria (o "›" é o separador do grupo, então sai do texto digitado)
  if (!n) return '';
  return g && g !== GRUPO_PADRAO ? `${g}${SEPARADOR_GRUPO}${n}` : n;
};

export const separarCategoria = (categoria: string) => {
  const i = categoria.indexOf(SEPARADOR_GRUPO);
  return i < 0 ? { grupo: GRUPO_PADRAO, nome: categoria } : { grupo: categoria.slice(0, i), nome: categoria.slice(i + SEPARADOR_GRUPO.length) };
};

/** Categorias agrupadas e em ordem alfabética, sem repetir; "Geral" primeiro */
export const agruparCategorias = (categorias: string[]) => {
  const grupos = new Map<string, Set<string>>();
  for (const c of categorias.map((x) => x.trim()).filter(Boolean)) {
    const { grupo } = separarCategoria(c);
    if (!grupos.has(grupo)) grupos.set(grupo, new Set());
    grupos.get(grupo)!.add(c);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === GRUPO_PADRAO ? -1 : b === GRUPO_PADRAO ? 1 : a.localeCompare(b)))
    .map(([grupo, itens]) => ({ grupo, categorias: [...itens].sort((a, b) => a.localeCompare(b)) }));
};
