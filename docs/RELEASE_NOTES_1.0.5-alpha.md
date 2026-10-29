# Release Notes Consolidadas

## Versao 1.0.5-alpha
- Tag: v1.0.5-alpha
- Commit alvo da tag: 4ca291d99ebcabdeb6913a185f8861c8fbec89c6
- Base de comparacao: 5c28bdf (ultimo release anterior no historico local)
- Escopo: consolidacao de estabilizacao de codigo, documentacao de release e roadmap de continuidade.

### Commits incluidos
1. 33a70e4 chore(release): bump to v1.0.5-alpha and persist current state
2. 9ba9128 docs(release): register v1.0.5-alpha commit hash
3. 4ca291d docs(refactor): add fase 8 customer experience roadmap

### Resumo quantitativo
1. 30 arquivos alterados.
2. 1692 insercoes e 303 delecoes.
3. Areas principais afetadas:
   - Backend de regras/rotas.
   - Frontend de supervisor, planejamento, escala, servicos, equipe e agendamentos.
   - Tipos compartilhados e documentacao de release/refactor.

### Mudancas funcionais e tecnicas principais
1. Estabilizacao de compilacao com correcao de JSX e fluxo condicional em telas de Servicos e Equipe.
2. Ajuste de tipagem no backend para calculo seguro de duracao de conflito (campo tempoHigienizacaoMin).
3. Alinhamento de contrato de props no Supervisor para compatibilidade de tipos com SupervisorEscalaTab.
4. Evolucoes em modulos de planejamento/escala/supervisao, incluindo melhorias estruturais em SupervisorView, TimelineGantt, Planejamento e componentes relacionados.
5. Atualizacao coordenada de versao para 1.0.5-alpha em root, frontend e backend.
6. Inclusao de artefatos/documentacao de release e extensao do roadmap no REFACTOR.

### Lista completa de arquivos alterados
1. M REFACTOR.md
2. A RELEASE_NOTES_1.0.4-alpha.md
3. A RELEASE_NOTES_1.0.5-alpha.md
4. M backend/package.json
5. M backend/routes.ts
6. M frontend/package.json
7. M frontend/src/App.tsx
8. M frontend/src/api.ts
9. M frontend/src/components/AnamneseForm.tsx
10. A frontend/src/components/AuditorModal.tsx
11. M frontend/src/components/CollaboratorView.tsx
12. M frontend/src/components/Layout.tsx
13. M frontend/src/components/LoginView.tsx
14. M frontend/src/components/ScheduleGridColumn.tsx
15. M frontend/src/components/SupervisorView.tsx
16. M frontend/src/components/TVPanelView.tsx
17. M frontend/src/features/appointments/components/BookingModal.tsx
18. M frontend/src/features/appointments/utils/appointmentCore.ts
19. M frontend/src/features/clients/components/SupervisorClientesTab.tsx
20. M frontend/src/features/planning/components/CalendarioEscala.tsx
21. M frontend/src/features/planning/components/DashboardEscalas.tsx
22. M frontend/src/features/planning/components/PlanningDayPopover.tsx
23. M frontend/src/features/planning/components/SupervisorPlanejamentoTab.tsx
24. M frontend/src/features/planning/components/TimelineGantt.tsx
25. M frontend/src/features/scale/components/SupervisorEscalaTab.tsx
26. M frontend/src/features/services/components/SupervisorServicosTab.tsx
27. M frontend/src/features/team/components/SupervisorEquipeTab.tsx
28. M frontend/src/types.ts
29. M package.json
30. A windsurf-stable.gpg

### Validacao Tecnica Executada
1. npm run lint
2. npm --prefix frontend run build

### Impacto Tecnico
1. Sem alteracao de contrato de API.
2. Sem alteracao de schema Prisma.
3. Mudancas de frontend concentradas em robustez, organizacao e consistencia visual/estrutural.
4. Release publicada com tag reposicionada para o commit documental mais recente da serie 1.0.5-alpha.
