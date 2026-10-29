# Release Notes Consolidadas

## Versao 1.0.4-alpha
- Commit: 5c28bdf813fb05ffb93dd912ec55d3b3402f3e46
- Escopo: hotfix de consistencia visual + sincronizacao final de versao.

### Adicionado
1. Nenhum incremento funcional novo nesta versao.

### Corrigido
1. Normalizacao de utilitario Tailwind para z-index no modal de proximos atendimentos, reduzindo warning de classe arbitraria e mantendo comportamento identico.
   - Arquivo: frontend/src/components/UpcomingAppointmentsModal.tsx
2. Bump coordenado de versao para 1.0.4-alpha em root, frontend e backend.
   - Arquivos: package.json, frontend/package.json, backend/package.json

### Impacto Tecnico
1. Sem alteracao de contrato de API.
2. Sem alteracao de schema Prisma.
3. Sem alteracao de fluxo de dados.
4. Mudanca focada em consistencia de estilo e rastreabilidade de release.

---

## Versao 1.0.3-alpha
- Commit: 9cda09bec4fdfc2d5823eb36113c1bde7a9c1136
- Escopo: evolucao de supervisao, timeline operacional e robustez de validacoes em rotas.

### Adicionado
1. Validacao de interjornada CLT (janela minima de descanso) no backend para criacao, edicao e realocacao de agendamentos.
   - Arquivo: backend/routes.ts
2. Endpoints de troca de turno com fallback de persistencia e ajuste automatico de override de escala na aprovacao.
   - Arquivo: backend/routes.ts
3. Subaba de gestao em equipe para catalogo de cargos e turnos padrao, com preenchimento rapido no modal de escala.
   - Arquivo: frontend/src/features/team/components/SupervisorEquipeTab.tsx
4. Heatmap/indicadores de cobertura na escala de supervisao e tooltips operacionais de contexto diario.
   - Arquivo: frontend/src/features/scale/components/SupervisorEscalaTab.tsx

### Corrigido
1. Fluxo de realocacao no grid de agenda com captura de erro em try/catch para feedback explicito de conflito (ex.: conflito CLT) ao inves de falso sucesso visual.
   - Arquivo: frontend/src/components/ScheduleGridColumn.tsx
2. Padronizacao de exibicao/entrada de telefone e CPF no fluxo de agendamento e edicao.
   - Arquivos: frontend/src/features/appointments/components/BookingModal.tsx, frontend/src/features/appointments/components/EditAppointmentModal.tsx
3. Formato de contato no comprovante impresso para evitar exibicao crua de numero.
   - Arquivo: frontend/src/features/appointments/utils/appointmentCore.ts
4. Correcao estrutural de JSX e refinamento de semantica visual na Timeline de planejamento (celulas, legenda, estados de cobertura e alerta).
   - Arquivo: frontend/src/features/planning/components/TimelineGantt.tsx
5. Ajustes visuais e semanticos no calendario de escala e dashboard de alertas.
   - Arquivos: frontend/src/features/planning/components/CalendarioEscala.tsx, frontend/src/features/planning/components/DashboardEscalas.tsx
6. Bump de versao para 1.0.3-alpha em root, frontend e backend.
   - Arquivos: package.json, frontend/package.json, backend/package.json

### Validacao Tecnica Executada
1. Typecheck frontend via lint do projeto.
2. Typecheck full-stack via tsconfig raiz (inclui backend).
3. Build de producao do frontend.
4. Verificacao de push em master.

### Risco Residual
1. Endpoints de troca de turno usam acesso SQL raw com fallback em arquivo JSON quando tabela nao existe; recomendavel roadmap de migracao para modelo Prisma dedicado para rastreabilidade de auditoria e garantias transacionais fim-a-fim.
