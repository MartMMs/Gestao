import { AnamneseData, initialAnamnese } from '../components/AnamneseForm';

export const ANAMNESE_MARKER = '__ANAMNESE_JSON__:';

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

export const hasAnamnese = (data: AnamneseData) =>
  Object.values(data).some(v => (Array.isArray(v) ? v.length > 0 : String(v || '').trim().length > 0));

export function parseClientObservation(obs?: string): ParsedAnamnese {
  const raw = (obs || '').trim();
  if (!raw) {
    return { note: '', anamSummary: [], anamJson: '', anamData: initialAnamnese };
  }

  const idx = raw.indexOf(ANAMNESE_MARKER);
  if (idx < 0) {
    return { note: raw, anamSummary: [], anamJson: '', anamData: initialAnamnese };
  }

  const note = raw.slice(0, idx).trim();
  const jsonPart = raw.slice(idx + ANAMNESE_MARKER.length).trim();

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
  return `${note.trim()}\n${ANAMNESE_MARKER}${JSON.stringify(data)}`.trim();
}
