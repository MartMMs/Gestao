import { HttpError } from './http';
import { JANELA_AGENDA_DIAS } from '../../shared/agendaJanela';

const UM_DIA_MS = 86_400_000;

// Início do período da agenda. Aceita só datas reais (AAAA-MM-DD) e nunca antes da janela máxima;
// a folga de um dia cobre a diferença de fuso entre o navegador e o banco.
export const lerDesde = (valor: unknown, agora = Date.now()): Date => {
  const limite = new Date(agora - (JANELA_AGENDA_DIAS + 1) * UM_DIA_MS);
  if (valor === undefined) return limite;
  const texto = typeof valor === 'string' ? valor : '';
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const data = partes ? new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]))) : null;
  const dataReal = data
    && data.getUTCFullYear() === Number(partes![1])
    && data.getUTCMonth() === Number(partes![2]) - 1
    && data.getUTCDate() === Number(partes![3]);
  if (!dataReal) throw new HttpError(400, 'Parâmetro "desde" inválido. Use uma data real no formato AAAA-MM-DD.');
  const inicio = new Date(data!.getTime() - UM_DIA_MS);
  return inicio < limite ? limite : inicio;
};
