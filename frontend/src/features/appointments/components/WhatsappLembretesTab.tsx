import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../../../api';
import { MensagensLembreteEditor } from './MensagensLembreteEditor';

type EstadoWhatsapp = {
  status: 'desconectado' | 'iniciando' | 'aguardando_qr' | 'conectado';
  qr: string | null;
  numero: string | null;
  enviadosHoje: number;
  limitePorDia: number;
};

const CHAVE = ['whatsapp-qr'];

// Conecta um número de WhatsApp lendo o QR code (como no WhatsApp Web) para mandar os lembretes de 24h
export function WhatsappLembretesTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery<EstadoWhatsapp>({
    queryKey: CHAVE,
    queryFn: () => fetchApi('/whatsapp/qr', token),
    // Enquanto espera a leitura, o QR muda a cada ~20 s: busca de novo com frequência
    refetchInterval: (q) => (q.state.data?.status === 'conectado' || q.state.data?.status === 'desconectado' ? 30_000 : 3000),
  });
  const acao = useMutation({
    mutationFn: (qual: 'conectar' | 'desconectar') => fetchApi(`/whatsapp/qr/${qual}`, token, { method: 'POST' }),
    onSuccess: (estado: EstadoWhatsapp) => queryClient.setQueryData(CHAVE, estado),
  });
  const erro = (acao.error ?? error) as Error | null;

  return (
    <div className="max-w-4xl space-y-6 bg-surface-container-lowest rounded-2xl p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-on-surface">WhatsApp dos lembretes</h2>
        <p className="text-sm text-on-surface-variant mt-1">
          O sistema manda um lembrete por WhatsApp para quem tem atendimento nas próximas 24 horas. Só lembretes: nenhuma outra mensagem sai por aqui.
        </p>
      </div>

      {erro && <p role="alert" className="text-sm text-error">{erro.message}</p>}

      {data?.status === 'conectado' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-primary">Conectado{data.numero ? ` ao número +${data.numero}` : ''}.</p>
          <p className="text-sm text-on-surface-variant">Hoje: {data.enviadosHoje} de {data.limitePorDia} lembretes enviados.</p>
          <button type="button" disabled={acao.isPending} onClick={() => acao.mutate('desconectar')}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container text-error cursor-pointer disabled:opacity-50">
            Desconectar
          </button>
        </div>
      )}

      {data?.status === 'aguardando_qr' && data.qr && (
        <div className="space-y-3">
          <img src={data.qr} alt="QR code para conectar o WhatsApp" className="w-64 h-64 bg-white p-2 rounded-xl" />
          <ol className="text-sm text-on-surface-variant list-decimal pl-5 space-y-1">
            <li>No celular, abra o WhatsApp e toque em <strong>Aparelhos conectados</strong>.</li>
            <li>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o código.</li>
          </ol>
        </div>
      )}

      {data?.status === 'iniciando' && <p className="text-sm text-on-surface-variant" aria-live="polite">Preparando a conexão…</p>}

      {(!data || data.status === 'desconectado') && (
        <button type="button" disabled={acao.isPending} onClick={() => acao.mutate('conectar')}
          className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary cursor-pointer disabled:opacity-50">
          Gerar QR code
        </button>
      )}

      <MensagensLembreteEditor token={token} />

      <div className="text-xs text-on-surface-variant border-t border-outline-variant pt-4 space-y-1">
        <p>Para o número não ser bloqueado: no máximo {data?.limitePorDia ?? 40} lembretes por dia, com uma pausa de 30 a 90 segundos entre eles, e só para números que têm WhatsApp.</p>
        <p>Use um número da casa, de preferência um que já esteja em uso há algum tempo. Mais tarde dá para trocar pela API oficial do WhatsApp.</p>
      </div>
    </div>
  );
}
