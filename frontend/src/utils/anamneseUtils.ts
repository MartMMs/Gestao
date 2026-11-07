import { AnamneseData, initialAnamnese } from '../components/AnamneseForm';
import type { Client } from '../types';

import {
  CAMPOS_LISTA_ANAMNESE,
  CAMPOS_TEXTO_ANAMNESE,
  MARCADOR_ANAMNESE,
  aparaObservacao,
  fichaPreenchida,
  linhasDoTotem,
  separarFicha,
  valorPreenchido,
} from '@shared/anamnese';

export interface ParsedAnamnese {
  note: string;
  anamSummary: string[];
  anamJson: string;
  anamData: AnamneseData;
}

const FIELD_LABELS: Record<string, string> = {
  profissao: 'Profissao',
  queixa: 'Queixa',
  proteses: 'Proteses/Pinos',
  cirurgia: 'Cirurgia recente',
  gravida: 'Gravida',
  caracteristicas: 'Caracteristicas',
  medicamentos: 'Medicamentos',
  procedimentoEstetico: 'Procedimento estetico (6m)',
  marcapasso: 'Marcapasso',
  outrosMedicamentos: 'Outros medicamentos',
  lentesContato: 'Lentes de contato',
  alergia: 'Alergias',
  patologia: 'Patologias',
  partesNaoTocadas: 'Partes não tocadas',
  preferencia: 'Preferencia',
  pressao: 'Pressao',
  banho: 'Banho',
  aromaterapia: 'Aromaterapia',
};

const normalizarAnamneseData = (dados: Record<string, unknown>): AnamneseData => {
  const resultado: AnamneseData = { ...initialAnamnese, caracteristicas: [], medicamentos: [] };
  for (const campo of CAMPOS_TEXTO_ANAMNESE) {
    const v = dados[campo];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      resultado[campo] = String(v);
    }
  }
  for (const campo of CAMPOS_LISTA_ANAMNESE) {
    const v = dados[campo];
    if (Array.isArray(v)) {
      resultado[campo] = v.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    }
  }
  return resultado;
};

// Há ficha, mas a API não mandou o conteúdo (LGPD: só a supervisão e o profissional do atendimento veem)
export const fichaOculta = (cliente: Pick<Client, 'temAnamnese' | 'acessoSaude'>) => cliente.temAnamnese === true && cliente.acessoSaude !== true;

// Mesma regra da API (shared/anamnese.ts)
export const hasAnamnese = (data: AnamneseData) => fichaPreenchida(data);

export function parseClientObservation(obs?: string | null): ParsedAnamnese {
  // Só o fim é aparado: tirar o espaço do começo de "  [Anamnese ..." a faria virar linha do totem ao regravar
  const raw = (obs || '').trimEnd();
  if (!raw.trim()) {
    return { note: '', anamSummary: [], anamJson: '', anamData: { ...initialAnamnese, caracteristicas: [], medicamentos: [] } };
  }

  // Ficha do totem: texto livre numa linha própria (fica na nota, que é regravada intacta); entra no resumo.
  // Mesmas regras da API (linhasDoTotem e separarFicha): o que a API conta como ficha, a tela mostra, e vice-versa
  const totem = linhasDoTotem(raw);
  const ficha = separarFicha(raw);
  // Sem ficha válida: a observação inteira é nota, intacta. Regravar põe a ficha nova no fim e ela vale (a última)
  if (!ficha?.dados || !fichaPreenchida(ficha.dados)) {
    return { note: raw, anamSummary: totem, anamJson: '', anamData: { ...initialAnamnese, caracteristicas: [], medicamentos: [] } };
  }

  const anamData = normalizarAnamneseData(ficha.dados);
  const summary = Object.entries(ficha.dados)
    // Mesma regra da API por campo (0 e false contam como preenchidos lá; com || a tela os escondia)
    .filter(([k, v]) => k in FIELD_LABELS && valorPreenchido(v))
    .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);

  return {
    note: ficha.nota,
    anamSummary: [...summary, ...totem],
    anamJson: ficha.json,
    anamData,
  };
}

export function formatAnamneseStorage(note: string, data: AnamneseData): string {
  const nota = aparaObservacao(note);
  if (!hasAnamnese(data)) return nota;
  // A ficha vai sempre por último: é a que separarFicha lê (vale o último marcador válido)
  const ficha = `${MARCADOR_ANAMNESE}${JSON.stringify(data)}`;
  return nota ? `${nota}\n${ficha}` : ficha;
}
