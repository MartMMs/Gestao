import type { AvisoAusencia } from '@shared/eventosSocket';

// Avisos de "cliente não pode comparecer" (resposta ao lembrete do WhatsApp): ficam até a pessoa fechar.
// Só recepção, supervisão e o profissional do atendimento recebem (o servidor não manda para o admin)
export function AvisosAusencia({ avisos, onFechar }: { avisos: AvisoAusencia[]; onFechar: (agendamentoId: string) => void }) {
  if (avisos.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-60 flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]" role="region" aria-label="Avisos de ausência de clientes">
      {avisos.map((a) => (
        <div key={a.agendamentoId} role="alert" className="flex items-start gap-3 rounded-2xl border border-error/30 bg-surface-container-lowest p-4 shadow-xl">
          <span className="material-symbols-outlined text-error" aria-hidden="true">event_busy</span>
          <p className="flex-1 text-sm text-on-surface">
            <strong>Cliente não pode comparecer:</strong> {a.cliente}, {a.data} às {a.horario}. Respondeu "Não poderei ir" no WhatsApp.
          </p>
          <button type="button" onClick={() => onFechar(a.agendamentoId)} aria-label="Fechar aviso" className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}
