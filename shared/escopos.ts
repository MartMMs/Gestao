// Listas que o aviso "db_updated" pode mandar recarregar. Os valores são as queryKeys do React Query no frontend:
// mudar um nome aqui muda nos dois lados ao mesmo tempo.
export const ESCOPOS_MUDANCA = ['appointments', 'employees', 'services', 'clients', 'scale-overrides', 'turno-swaps'] as const;
export type EscopoMudanca = (typeof ESCOPOS_MUDANCA)[number];

export const ehEscopoMudanca = (valor: unknown): valor is EscopoMudanca =>
  typeof valor === 'string' && (ESCOPOS_MUDANCA as readonly string[]).includes(valor);

// O que cada tipo de alteração afeta (e por quê):
export const ESCOPOS = {
  // Agendamento novo/editado pode criar cliente; bloqueios de agenda vivem no cadastro do profissional
  agenda: ['appointments', 'employees', 'clients'],
  // Reserva do totem cria agendamento e, às vezes, cliente
  reservaTotem: ['appointments', 'clients'],
  // O nome do cliente nos cards da agenda é recarregado pelo frontend (ver DEPENDENCIAS_ESCOPO)
  clientes: ['clients'],
  servicos: ['services'],
  // Desligar/realocar profissional move agendamentos
  equipe: ['employees', 'appointments'],
  // Override, troca e replicação de escala mexem na escala e nos dados do profissional
  escala: ['employees', 'scale-overrides', 'turno-swaps'],
  // Manutenção periódica cancela reservas vencidas e marca não comparecimentos
  manutencao: ['appointments'],
} as const satisfies Record<string, readonly EscopoMudanca[]>;

// Só agendamentos e serviços mudam o que o totem mostra (catálogo e horários ocupados). Escala, equipe sem
// realocação e clientes não geram aviso nenhum para conexões sem login, nem vazio.
export const ESCOPOS_PUBLICOS: readonly EscopoMudanca[] = ['appointments', 'services'];

// Listas que o frontend recarrega junto: os cards da agenda mostram dados do cliente
export const DEPENDENCIAS_ESCOPO: Partial<Record<EscopoMudanca, readonly EscopoMudanca[]>> = {
  clients: ['appointments'],
};
