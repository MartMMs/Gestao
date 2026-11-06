import { AnamneseData, initialAnamnese } from '../components/AnamneseForm';

import { MARCADOR_ANAMNESE, fichaPreenchida } from '@shared/anamnese';

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

// Mesma regra da API (shared/anamnese.ts)
export const hasAnamnese = (data: AnamneseData) => fichaPreenchida(data);

export function parseClientObservation(obs?: string): ParsedAnamnese {
  const raw = (obs || '').trim();
  if (!raw) {
    return { note: '', anamSummary: [], anamJson: '', anamData: initialAnamnese };
  }

  const idx = raw.indexOf(MARCADOR_ANAMNESE);
  if (idx < 0) {
    return { note: raw, anamSummary: [], anamJson: '', anamData: initialAnamnese };
  }

  const note = raw.slice(0, idx).trim();
  const jsonPart = raw.slice(idx + MARCADOR_ANAMNESE.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    const summary = Object.entries(parsed)
      .filter(([, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return String(v || '').trim().length > 0;
      })
      .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);

    return {
      note,
      anamSummary: summary,
      anamJson: jsonPart,
      anamData: { ...initialAnamnese, ...parsed } as AnamneseData,
    };
  } catch {
    return { note: raw, anamSummary: [], anamJson: '', anamData: initialAnamnese };
  }
}

export function formatAnamneseStorage(note: string, data: AnamneseData): string {
  if (!hasAnamnese(data)) return note.trim();
  return `${note.trim()}\n${MARCADOR_ANAMNESE}${JSON.stringify(data)}`.trim();
}
