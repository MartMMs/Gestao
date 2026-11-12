import { normalizarTexto } from '@shared/validadores';
import { bloqueioDiaInteiro } from '@shared/agenda';
import type { DiaEscala } from '@shared/escala';
import type { Bloqueio } from '../../../types';

export type EmployeeDayStatus = {
  label: 'Folga' | 'FDS' | 'Férias' | 'Bloqueio';
  reason: string;
  isAllDayUnavailable: boolean;
};

type AjusteDoDia = { tipo: 'trabalho' | 'folga' | 'fds'; descricao?: string };

const ehFerias = (texto?: string | null) => Boolean(texto && normalizarTexto(texto).includes('ferias'));

// Situação do profissional no dia: escala base, depois ajuste da escala, depois bloqueios do dia (nessa ordem)
export const statusDoDia = (
  diaEscala: DiaEscala | undefined,
  ajuste: AjusteDoDia | undefined,
  bloqueiosDoDia: Bloqueio[],
): EmployeeDayStatus | null => {
  if (diaEscala && diaEscala.tipo !== 'trabalho') {
    return {
      label: ehFerias(diaEscala.descricao) ? 'Férias' : (diaEscala.tipo === 'fds' ? 'FDS' : 'Folga'),
      reason: diaEscala.descricao || 'Folga contratual (Escala)',
      isAllDayUnavailable: true,
    };
  }

  if (ajuste && ajuste.tipo !== 'trabalho') {
    if (ehFerias(ajuste.descricao)) return { label: 'Férias', reason: ajuste.descricao || 'Férias planejadas', isAllDayUnavailable: true };
    if (ajuste.tipo === 'fds') return { label: 'FDS', reason: ajuste.descricao || 'Fim de semana (escala)', isAllDayUnavailable: true };
    return { label: 'Folga', reason: ajuste.descricao || 'Folga planejada', isAllDayUnavailable: true };
  }

  if (bloqueiosDoDia.length === 0) return null;
  const diaInteiro = bloqueiosDoDia.find(bloqueioDiaInteiro);
  if (!diaInteiro) {
    return {
      label: 'Bloqueio',
      reason: bloqueiosDoDia.map((b) => b.motivo).filter(Boolean).join(' | ') || 'Bloqueio parcial',
      isAllDayUnavailable: false,
    };
  }
  return { label: ehFerias(diaInteiro.motivo) ? 'Férias' : 'Folga', reason: diaInteiro.motivo, isAllDayUnavailable: true };
};

// Filtro "Somente de folga": fora o dia todo; bloqueio parcial (algumas horas) não conta
export const estaDeFolga = (status: EmployeeDayStatus | null | undefined) =>
  Boolean(status?.isAllDayUnavailable && status.label !== 'Bloqueio');
