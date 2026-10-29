# 💻 Código Pronto - FASE 1 (Copy-Paste)

---

## 1️⃣ Crie: `src/config/scheduleConfig.ts`

```typescript
export const SCHEDULE_CONFIG = {
  START_HOUR: 9,
  END_HOUR: 21,
  HOUR_HEIGHT: 34,
  
  get MINUTE_HEIGHT() {
    return this.HOUR_HEIGHT / 60;
  },
  
  isValidBusinessHour(hour: number): boolean {
    return hour >= this.START_HOUR && hour < this.END_HOUR;
  },
  
  getTopOffset(hour: number, minute: number = 0): number {
    return ((hour - this.START_HOUR) * 60 + minute) * this.MINUTE_HEIGHT;
  },
} as const;
```

---

## 2️⃣ Crie: `src/config/api.ts`

```typescript
export function getApiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  
  const host = window.location.hostname;
  const port = 3333;
  return `http://${host}:${port}/api`;
}

export function getSocketUrl(): string {
  const envUrl = import.meta.env.VITE_SOCKET_URL;
  if (envUrl) return envUrl;
  
  const host = window.location.hostname;
  const port = 3333;
  return `http://${host}:${port}`;
}

if (import.meta.env.DEV) {
  console.log('[API]', { api: getApiUrl(), socket: getSocketUrl() });
}
```

---

## 3️⃣ Crie: `src/utils/anamneseUtils.ts`

```typescript
import { AnamneseData, initialAnamnese } from '../components/AnamneseForm';

export const ANAMNESE_MARKER = '__ANAMNESE_JSON__:';

export interface ParsedAnamnese {
  note: string;
  anamSummary: string[];
  anamJson: string;
  anamData: AnamneseData;
}

const FIELD_LABELS: Record<string, string> = {
  profissao: 'Profissão',
  queixa: 'Queixa',
  proteses: 'Próteses/Pinos',
  cirurgia: 'Cirurgia Recente',
  gravida: 'Grávida',
  caracteristicas: 'Características',
  medicamentos: 'Medicamentos',
  procedimentoEstetico: 'Procedimento Estético (6m)',
  marcapasso: 'Marcapasso',
  outrosMedicamentos: 'Outros Medicamentos',
  lentesContato: 'Lentes de Contato',
  alergia: 'Alergias',
  patologia: 'Patologias',
  partesNaoTocadas: 'Partes Não Tocadas',
  preferencia: 'Preferência de Tratamento',
  pressao: 'Pressão da Massagem',
  banho: 'Banho',
  aromaterapia: 'Aromaterapia (Profissional)',
};

export function parseClientObservation(obs?: string): ParsedAnamnese {
  const raw = (obs || '').trim();
  
  if (!raw) {
    return {
      note: '',
      anamSummary: [],
      anamJson: '',
      anamData: initialAnamnese,
    };
  }

  const markerIdx = raw.indexOf(ANAMNESE_MARKER);
  if (markerIdx < 0) {
    return {
      note: raw,
      anamSummary: [],
      anamJson: '',
      anamData: initialAnamnese,
    };
  }

  const note = raw.slice(0, markerIdx).trim();
  const jsonPart = raw.slice(markerIdx + ANAMNESE_MARKER.length).trim();

  try {
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>;
    
    const summary = Object.entries(parsed)
      .filter(([, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return String(v || '').trim().length > 0;
      })
      .map(([k, v]) => {
        const label = FIELD_LABELS[k] || k;
        const value = Array.isArray(v) ? v.join(', ') : String(v);
        return `${label}: ${value}`;
      });

    return {
      note,
      anamSummary: summary,
      anamJson: jsonPart,
      anamData: { ...initialAnamnese, ...parsed } as AnamneseData,
    };
  } catch {
    return {
      note: raw,
      anamSummary: [],
      anamJson: '',
      anamData: initialAnamnese,
    };
  }
}

export function formatAnamneseStorage(note: string, data: AnamneseData): string {
  const hasAnamnese = Object.values(data).some(v => {
    if (Array.isArray(v)) return v.length > 0;
    return String(v || '').trim().length > 0;
  });

  if (!hasAnamnese) {
    return note.trim();
  }

  const json = JSON.stringify(data);
  const combined = `${note.trim()}\n${ANAMNESE_MARKER}${json}`.trim();
  return combined;
}

export function hasAnamnese(obs?: string): boolean {
  return !!obs?.includes(ANAMNESE_MARKER);
}

export function getAnamneseSummary(data: AnamneseData): string[] {
  return Object.entries(data)
    .filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return String(v || '').trim().length > 0;
    })
    .map(([k, v]) => {
      const label = FIELD_LABELS[k] || k;
      const value = Array.isArray(v) ? v.join(', ') : String(v);
      return `${label}: ${value}`;
    });
}
```

---

## 4️⃣ Atualize: `src/App.tsx`

**Remova a linha 34:**
```typescript
// const API_URL = `http://${window.location.hostname}:3333`;
```

**Adicione no topo (depois de outros imports):**
```typescript
import { getSocketUrl } from './config/api';
```

**Substitua linha ~106 (busque `const socket = io`):**
```typescript
// De:
// const socket = io(API_URL);

// Para:
const socket = io(getSocketUrl());
```

---

## 5️⃣ Atualize: `src/AuthContext.tsx`

**Remova a linha 5:**
```typescript
// const API_URL = `http://${window.location.hostname}:3333`;
```

**Adicione no topo:**
```typescript
import { getApiUrl } from './config/api';
```

**Substitua linha ~24 (busque `fetch`):**
```typescript
// De:
// const response = await fetch(`${API_URL}/api/login`, {

// Para:
const response = await fetch(`${getApiUrl()}/login`, {
```

---

## 6️⃣ Atualize: `src/api.ts`

**Remova a linha que define `API_URL`:**
```typescript
// const API_URL = ...
```

**Adicione no topo:**
```typescript
import { getApiUrl } from './config/api';
```

**Substitua todas as chamadas:**
```typescript
// De:
// fetch(`${API_URL}/...`)

// Para:
// fetch(`${getApiUrl()}/...`)
```

Use Ctrl+H (Find & Replace) para encontrar `${API_URL}` e substituir por `${getApiUrl()}` em todo o arquivo.

---

## 7️⃣ Atualize: `src/components/CollaboratorView.tsx`

**Remova as linhas que definem constantes de esquema:**
```typescript
// const START_HOUR = 9;
// const END_HOUR = 21;
// const HOUR_HEIGHT = 34;
// const MINUTE_HEIGHT = HOUR_HEIGHT / 60;
```

**Adicione no topo:**
```typescript
import { SCHEDULE_CONFIG } from '../config/scheduleConfig';
```

**Substitua usages:**
```typescript
// De:
// START_HOUR, END_HOUR, HOUR_HEIGHT, MINUTE_HEIGHT

// Para:
const { START_HOUR, END_HOUR, HOUR_HEIGHT, MINUTE_HEIGHT } = SCHEDULE_CONFIG;
```

Se estiver usando em múltiplos locais, adicione uma linha após o import:
```typescript
const { START_HOUR, END_HOUR, HOUR_HEIGHT, MINUTE_HEIGHT } = SCHEDULE_CONFIG;
```

---

## 8️⃣ Atualize: `src/components/BookingModal.tsx`

**Remova a função normalizeSearch:**
```typescript
// const normalizeSearch = (str: string) => { ... }
```

**Remova a linha que importa/define ANAMNESE_MARKER:**
```typescript
// const ANAMNESE_MARKER = '__ANAMNESE_JSON__:';
```

**Remova as funções parseClientObservation etc:**
```typescript
// Remova qualquer função que comece com:
// const parseClientObservation = ...
// const hasAnamnese = ...
```

**Adicione no topo:**
```typescript
import { parseClientObservation, formatAnamneseStorage, ANAMNESE_MARKER } from '../utils/anamneseUtils';
```

**Substitua qualquer chamada:**
```typescript
// Toda referência a parseClientObservation já funcionará
// Toda referência a ANAMNESE_MARKER já funcionará
```

---

## 9️⃣ Atualize: `src/components/SupervisorClientesTab.tsx`

**Remova as linhas que copiam parseClientObservation:**
```typescript
// Procure por "const parseObservationAndAnamnese" ou similar
// Remova essa função inteira
```

**Adicione no topo:**
```typescript
import { parseClientObservation, formatAnamneseStorage, getAnamneseSummary } from '../utils/anamneseUtils';
```

**Substitua usages:**
```typescript
// De:
// const { note, items, data } = parseObservationAndAnamnese(obs);

// Para:
// const parsed = parseClientObservation(obs);
// const note = parsed.note;
// const items = parsed.anamSummary;
// const data = parsed.anamData;
```

---

## ✅ Checklist de Implementação

- [x] Criar `src/config/scheduleConfig.ts`
- [x] Criar `src/config/api.ts`
- [x] Criar `src/utils/anamneseUtils.ts`
- [x] Atualizar App.tsx
- [x] Atualizar AuthContext.tsx
- [x] Atualizar api.ts
- [x] Atualizar CollaboratorView.tsx
- [x] Atualizar BookingModal.tsx
- [x] Atualizar SupervisorClientesTab.tsx
- [x] Rodar: `npm run build`
- [x] Rodar: `npm run lint` (se existir)
- [x] Testar manualmente:
  - [x] Login funciona
  - [x] Agenda exibe corretamente
  - [x] Modal de booking abre
  - [x] Cliente history funciona

---

## 💡 Dicas

✅ **Seguro fazer:**
1. Cria novo arquivo
2. Testa se compila (`npm run build`)
3. Atualiza 1 componente
4. Testa novo
5. Próximo componente

❌ **Não fazer:**
- Tudo de uma vez
- Remover código antes de compilar
- Misturar múltiplas mudanças

---

**Good luck! 🚀**
