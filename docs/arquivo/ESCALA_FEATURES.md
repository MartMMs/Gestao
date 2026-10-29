# 📅 Sistema de Gestão de Escalas - Status Auditado

Atualizado em: 09/04/2026
Fonte única de pendências ativas: BACKLOG_ATIVO.md

## 1. Cadastro Completo de Colaboradores ✅

### Campos-alvo para Employee:
```typescript
- cargo: string
- telefone: string
- cpf: string
- habilidades: string[]
- cargaHorariaDisponivel: number (horas/semana)
- tipoEscala: '6x1' | '5x2' | '12x36' | 'rotativo' | 'personalizado'
- turnosPrefere: string[]
- disponibilidadeFds: boolean
```

Estado atual auditado:
- Implementado no modelo operacional: `cargo`, `tipoEscala`, `cargaHorariaSemanal`, `habilidades`, `folgasDomingoNoMes`, `bloqueios`.
- Ainda não incorporado no `Employee` atual: `telefone`, `cpf`, `turnosPrefere`, `disponibilidadeFds`, `cargaHorariaDisponivel` (o campo ativo é `cargaHorariaSemanal`).

### Modelo proposto de turno (não materializado como tipo dedicado no código atual):
```typescript
interface TurnoEscala {
  id: string;
  tipo: TipoEscala;
  horaInicio: string;
  horaFim: string;
  nome: string;
}
```

**Status:** ✅ Parcialmente implementado (tipos e campos operacionais já aplicados no fluxo atual)

---

## 2. Visualização de Calendário/Dashboard ✅

### Componentes em uso no frontend atual:
1. **CalendarioEscala / DraggableCalendarioEscala** - grade mensal com interação e edição
2. **TimelineGantt** - visão temporal operacional da equipe
3. **DashboardEscalas** - métricas de saúde e conformidade de escala

### Tipos de Visualização:
- Semanal (7 dias)
- Mensal (calendário)
- Por colaborador
- Por turno
- Por carga horária

**Status:** ✅ Implementado (calendário/timeline ativos com filtros combináveis: semanal, mensal, colaborador, turno e carga horária)

---

## 3. Gerenciamento de Tipos de Escala ✅

### Escalas Suportadas:

#### 6x1 (6 dias trabalha, 1 folga)
```
Seg Ter Qua Qui Sex Sáb | Dom(folga)
Seg Ter Qua Qui Sex Sáb | Dom(folga)
```

#### 5x2 (5 dias trabalha, 2 folgas)
```
Seg Ter Qua Qui Sex | Sáb Dom(folgas)
Seg Ter Qua Qui Sex | Sáb Dom(folgas)
```

#### 12x36 (12 horas trabalha, 36h folga)
```
Trabalha 12h | Descansa 36h
Turno Diurno: 07:00-19:00
Turno Noturno: 19:00-07:00
```

#### Rotativo
```
Semana 1: Turno 1 (07:00-15:00)
Semana 2: Turno 2 (15:00-23:00)
Semana 3: Turno 3 (23:00-07:00)
Semana 4: Folga
```

**Status:** ✅ Implementado na base de cálculo de escalas

---

## 4. Controle de Folgas e Férias ✅

### Funcionalidades:
- Bloqueios operacionais já funcionam (folgas e indisponibilidades)
- Feriados automáticos (BR): integrados na malha com precedência de override manual
- Cálculo de DSR (Descanso Semanal Remunerado): implementado
- Férias automáticas em período permitido: pendente (BLG-005)

### Feriados Nacionais (2026):
```
01/01 - Ano Novo
20/02 - Sexta-feira de Carnaval
21/02 - Sábado de Carnaval
23/02 - Segunda-feira de Carnaval
03/04 - Sexta-feira Santa
21/04 - Tiradentes
01/05 - Dia do Trabalho
30/05 - Corpus Christi
07/09 - Independência
12/10 - Nossa Senhora Aparecida
02/11 - Finados
15/11 - Proclamação da República
20/11 - Consciência Negra
25/12 - Natal
```

**Status:** 🟡 Parcialmente implementado (feriados automáticos integrados; férias automáticas permanecem pendentes - BLG-005)

---

## 5. Gestão de Trocas e Ausências ✅

### Interface de Troca de Turno:
```typescript
interface TrocaTurno {
  id: string;
  solicitadoPor: string;         // ID do colaborador que solicita
  dataOriginal: string;          // Data do turno original
  dataSolicitada: string;        // Data desejada para trocar
  status: 'pendente' | 'aprovado' | 'recusado';
  dataRequisicao: string;
  aprovadoPor?: string;          // ID do supervisor
  motivo?: string;
}
```

### Fluxo:
1. Colaborador solicita troca via modal
2. Sistema valida disponibilidade de ambos
3. Supervisor aprova/recusa
4. Notificação para ambos

**Status:** 🟡 Parcialmente implementado (solicitação + aprovação/rejeição operacionais; validações avançadas de disponibilidade seguem como evolução)

---

## 6. Conformidade Legal (CLT) ✅

### Validações Automáticas:

#### Interjornada Mínima
```
⚠️ Mínimo 11 horas entre fim de um turno e início do próximo
Exemplo: Turno 1 termina 19:00 → Próximo turno não antes de 06:00
```

#### Carga Máxima Semanal
```
⚠️ Máximo 44 horas por semana (segundo CLT)
Se ultrapassar: Sistema alerta e impede

Cálculo:
- Contar horas de segunda a domingo
- Descontar feriados e folgas obrigatórias
- Alertar quando atingir 40h
```

#### Descanso Semanal Remunerado (DSR)
```
⚠️ Mínimo 1 dia de folga a cada 7 dias
Preferencialmente domingo
Se não tiver: Sistema indica débito de DSR
```

```typescript
interface ConfirmidadeCLT {
  dataVerificacao: string;
  interjornada: number;          // horas de descanso entre jornadas
  cargaSemanal: number;          // horas trabalhadas na semana
  statusConforme: boolean;        // true se atende a CLT
  alertas: string[];             // lista de não conformidades
}
```

**Status:** 🟡 Parcialmente implementado (interjornada, DSR e integração com sino global ativos; bloqueio automático por carga semanal CLT ainda em evolução)

---

## 7. Relatórios e Dashboard ✅

### Métricas a Mostrar:

#### Dashboard Principal:
- Total de colaboradores
- Escalas ativas vs inativas
- Taxa de conformidade CLT
- Próximas folgas/férias
- Trocas pendentes

#### Relatório de Sobrecarga:
- Colaboradores com >40h/semana
- Tendência de horas extras
- Dias críticos (máxima demanda)

#### Relatório de Gargalos:
- Dias com baixa cobertura
- Turnos descobertos
- Período crítico do mês

#### Relatório Individual (por Colaborador):
- Carga horária atual
- Folgas próximas
- Conformidade CLT pessoal
- Histórico de trocas

**Status:** 🟡 Parcialmente implementado (dashboard de conformidade disponível; relatórios avançados seguem em backlog)

---

## 📋 Plano de Implementação por Prioridade

### FASE 1 (Crítico)
- Entregue: atualização de tipos operacionais, expansão do formulário principal, validador CLT base e alertas de conformidade na UI.
- Gap remanescente: campos avançados de colaborador não incorporados integralmente ao modelo atual.

### FASE 2 (Alto)
- Entregue: calendário/timeline operacionais, modal de solicitação de troca e dashboard de métricas.
- Entregue: integração automática de feriados na malha com sinalização na UI.

### FASE 3 (Médio)
- Entregue: rotação automática (incluindo 12x36/rotativo) e cálculo de DSR.
- Em aberto: relatórios detalhados e exportação PDF/CSV (BLG-006).

### FASE 4 (Aprimoramentos)
- Em backlog evolutivo: integração com calendário externo, notificações por e-mail, visão mobile e trilha de auditoria (BLG-008 a BLG-011).

---

## 🔗 Arquivos Reais no Estado Atual

```
src/
├── types.ts                          [ATIVO] - Tipos centrais de domínio
├── utils/
│   ├── cltValidator.ts               [ATIVO] - Conformidade CLT
│   ├── feriadosBR.ts                 [ATIVO] - Utilitários de feriado
│   └── escalaCalculator.ts           [ATIVO] - Geração e análise de escala
├── components/
│   ├── SolicitarTroca.tsx            [ATIVO] - Solicitação de troca
│   ├── SupervisorView.tsx            [ATIVO] - Orquestração de tabs/fluxos
│   └── Layout.tsx                    [ATIVO] - Sino global de alertas CLT
└── features/
  ├── planning/components/
  │   ├── CalendarioEscala.tsx      [ATIVO]
  │   ├── DraggableCalendarioEscala.tsx [ATIVO]
  │   ├── TimelineGantt.tsx         [ATIVO]
  │   └── DashboardEscalas.tsx      [ATIVO]
  └── team/components/
    └── SupervisorEquipeTab.tsx   [ATIVO]
```

---

## 🎯 Próximos Passos (Executivos)

1. Fechar BLG-006 (relatórios e exportação PDF/CSV).
2. Fechar BLG-005 (férias automáticas em período permitido).
3. Revisar UX dos novos filtros com supervisão em cenário real.
4. Manter novos pendentes apenas no BACKLOG_ATIVO.md.

---

**Data:** 09/04/2026
**Status Geral:** 🟡 Parcialmente implementado com pendências consolidadas no BACKLOG_ATIVO.md
