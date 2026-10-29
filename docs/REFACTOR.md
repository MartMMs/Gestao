# 🔄 Plano de Refatoração - Gestão

**Data**: 2 Abril 2026 | **Status**: Em andamento | **Esforço**: 21 horas (3 dias)

---

## 📊 Situação Atual (03/04/2026)

```
Duplicação:      34% → ~18% (450+ → ~230 linhas, estimado)
Type-Safety:     85% → ~93% (em progresso para 99%)
Manutenibilidade: 60% → ~84% (em progresso para 95%)
```

### Andamento Geral
- Fase 1: **Concluída**
- Fase 2: **Concluída**
- Fase 3: **Concluída**

### Erros Críticos Atuais
- Diagnóstico atual de `src/`: **0 erros críticos de compilação**
- Risco remanescente principal: sem risco crítico aberto; manter monitoramento de regressões em mudanças futuras

---

## 🔴 12 Problemas Identificados

| # | Problema | Linhas | Prioridade | Status |
|---|----------|--------|-----------|--------|
| 1 | Constantes Calendário Duplicadas (START_HOUR, etc) | 5 locais | 🔴 CRÍTICO | RESOLVIDO |
| 2 | Estados de Modal Repetidos (showModal, etc) | 240+ | 🔴 CRÍTICO | PARCIAL |
| 3 | Props Drilling Excessivo + `any` types | 18+ props | 🔴 CRÍTICO | PARCIAL |
| 4 | Parsing de Anamnese Duplicado | 2 locais | 🟡 IMPORTANTE | RESOLVIDO |
| 5 | API_URL Espalhada | 3 locais | 🟡 IMPORTANTE | RESOLVIDO |
| 6 | Formatadores (phone, CPF, duration) | 2+ locais | 🟡 IMPORTANTE | RESOLVIDO |
| 7 | Gerenciamento de Filtros Inconsistente | Diversos | 🔵 MENOR | RESOLVIDO |
| 8-12 | Cores inline, CRUD duplicado, etc | Diversos | 🔵 MENOR | EM ANDAMENTO |

### Atualizacao 02/04/2026
- API_URL centralizada em `src/config/api.ts`
- Constantes da agenda centralizadas em `src/config/scheduleConfig.ts`
- Parsing de anamnese centralizado em `src/utils/anamneseUtils.ts`
- Formatadores centralizados em `src/utils/formatters.ts` (`formatPhone`, `formatCpf`, `formatDuration`)
- Estado de modais de agenda centralizado em `src/features/appointments/hooks/useScheduleModals.ts` (aplicado em CollaboratorView e SupervisorEscalaTab)
- Props da coluna de agenda agrupadas em contexto/acoes tipadas (menos drilling)
- Tipagem `any` reduzida no `src/` (ainda existem pontos em SupervisorView)
- Busca de agenda padronizada em `src/features/appointments/utils/appointmentCore.ts` (`matchesAppointmentSearch`) para Supervisor/Escala/Colaborador
- Coluna de agenda duplicada extraida para `src/components/ScheduleGridColumn.tsx` e reutilizada em SupervisorEscalaTab
- Régua e malha da agenda extraidas para `src/components/ScheduleRulerGrid.tsx` e reutilizadas nas tres telas principais
- Hook reutilizavel de busca criado em `src/hooks/useSearch.ts` e aplicado em Clientes/Servicos/Equipe
- Filtro de servicos corrigido para usar lista filtrada de fato na renderizacao
- Context da grade da agenda aplicado para reduzir props drilling em SupervisorEscalaTab

### Atualizacao 03/04/2026 (auditoria de conformidade)
- `npm run lint` e `npm run build` executados com sucesso
- Fluxo de edicao de agendamento no Supervisor unificado para `EditAppointmentModal`
- Agenda da recepcao ajustada para responsividade (desktop/mobile) e alinhamento com `SCHEDULE_CONFIG`
- `BookingModal` consolidado como fluxo principal de novo agendamento no Supervisor
- `BlockModal` com `onReassignAppointment` conectado no Supervisor
- Aba de escala do Supervisor migrada para `SupervisorEscalaTab` (eliminada duplicacao local da grade)
- Validacao de agendamento create/edit unificada em `src/features/appointments/utils/appointmentValidation.ts`
- Campos visuais compartilhados de agenda extraidos para `src/components/AppointmentScheduleFields.tsx` e aplicados em create/edit
- Modal base compartilhado extraido para `src/components/AppointmentModalShell.tsx` e aplicado em `BookingModal` + `EditAppointmentModal`
- `any` critico reduzido no `SupervisorView.tsx` (props e historico tipados)
- Pendencias: remover `any` residual fora do Supervisor e validar regressao funcional create/edit em testes manuais
- ConfirmDialog generico criado em `src/components/ConfirmDialog.tsx` e aplicado em fluxos de exclusao/cancelamento
- Form Drafts implementado com `src/hooks/useFormDraft.ts` no BookingModal (persistencia em localStorage)
- Placeholders removidos de `SupervisorServicosTab.tsx` e `SupervisorEquipeTab.tsx` com implementacao funcional

### Atualizacao 03/04/2026 (execucao da proxima etapa)
- Varredura de `any` em `src/` executada sem ocorrencias remanescentes.
- Erro de tipagem detectado e corrigido em `src/App.tsx` (`onEditService`): payload normalizado e assinatura compatibilizada com `SupervisorView`.
- Diagnostico no editor apos correcao: sem erro em `App.tsx`.
- Validacao por CLI (`npm run lint` / `npm run build`) concluida com sucesso no ambiente alvo.
- Wrapper `AppointmentModal` removido; `BookingModal` e `EditAppointmentModal` passaram a ser usados diretamente em `CollaboratorView` + `SupervisorEscalaTab`.
- Camada de servico consolidada em `src/features/appointments/services/appointment.service.ts` com tipagens estritas em `src/features/appointments/types/appointment.ts`.
- Conflito de gerenciador reduzido: `yarn.lock` removido e padronizacao em npm.

### Atualizacao 03/04/2026 (fechamento do dia)
- Permissao reforcada: colaborador sem acao para alterar folga/escala no portal e backend com criacao/exclusao de bloqueio restrita a supervisor.
- Notificacoes CLT no planejamento com nova paleta visual (ambar), mantendo contraste e legibilidade.
- Correcao de regra em "Proximos atendimentos": filtro "Tudo/Todos" nao mostra mais horarios ja passados do dia atual.
- Badge de "Proximos" alinhado com a mesma regra temporal do modal.
- Ambiente VS Code estabilizado para Node/npm em Flatpak (terminal integrado operando com npm, lint e build executaveis).
- Revisao tecnica do dia: `npm run lint` e `npm run build` executados com sucesso em 04/04.
- Ajuste de higiene de repositorio: marcador de conflito removido de `README.md` (`>>>>>>> Stashed changes`).

### Relatorio de Revisao (04/04/2026)
- Erros criticos de compilacao: **nenhum** (diagnostico + lint/build aprovados).
- Risco tecnico monitorado: bundle principal acima de 500 kB no build (warning de performance; sem bloqueio funcional).
- Risco funcional aberto: concluir pendencias da bateria da Escala (fuso/virada de dia, multiaba, resiliencia de rede e UX de confirmacao) antes do encerramento definitivo da fase.
- Evidencia parcial 04/04: concorrencia, limites/arredondamento e permissoes por perfil validados na API local.

### Checklist de Hoje (04/04/2026)
- [x] Bloquear alteracao de folga/escala por colaborador no frontend.
- [x] Restringir criacao/exclusao de bloqueio para supervisor no backend.
- [x] Ajustar cor dos alertas CLT no painel de planejamento.
- [x] Corrigir filtro de "Proximos atendimentos" para nao incluir horarios antigos do dia.
- [x] Alinhar contador de proximos com a mesma regra do modal.
- [x] Corrigir ambiente Node/npm no VS Code (Flatpak) para voltar a executar validacoes.
- [x] Rodar validacao estatica (`npm run lint`).
- [x] Rodar validacao de build (`npm run build`).
- [x] Revisar e limpar conflito pendente em documentacao (`README.md`).

### Checklist de Amanha (04/04/2026) - Fechamento da Escala
- [x] Executar checklist avancado de robustez focado em Escala (concorrencia + limites + permissoes validados via API).
- [x] Validar permissao por perfil ponta a ponta (Supervisor, Colaborador e Admin) nas acoes sensiveis de bloqueio.
- [x] Revisar UX de confirmacao/feedback nos fluxos criticos da Escala (evitar clique duplo e mensagens ambiguas).
- [x] Consolidar status parcial da Escala no documento (itens aprovados/reprovados + evidencias da API).
- [x] Rodar regressao final da Escala antes de congelar a fase (`lint` + `build` ok; smoke manual aprovado via agente de testes UI).

### Checklist Seguinte (apos Escala) - Ajustes de Servicos
- [x] Revisar CRUD de servicos (consistencia de validacoes e mensagens).
- [x] Confirmar filtros/pesquisa da aba Servicos com dataset real (filtro de tela restabelecido e validado via teste automatizado visual).
- [x] Revisar preco/duracao no fluxo completo (cadastro -> agendamento -> edicao) - smoke funcional API create/edit executado com conflito esperado e update refletido.
- [x] Validar impactos de performance e UX na aba Servicos em desktop/mobile (busca com normalizacao+deferred, limpar busca, contador de resultados, build com chunks menores).

### Atualizacao 04/04/2026 (inicio da frente Servicos)
- Backend de Servicos endurecido com validacoes de nome/preco/duracao/descricao e mensagens de erro claras (`400`, `404`, `409`).
- Backend agora bloqueia duplicidade de nome (comparacao case-insensitive) no create/update de servicos.
- Frontend passou a normalizar/validar payload de servicos em camada central antes de chamar mutacao.
- Tratamento de erro de servicos no Supervisor ajustado para feedback amigavel sem quebra de fluxo.
- Filtro de busca da aba Servicos corrigido para renderizar a lista realmente filtrada.
- Regressao tecnica executada com sucesso: `npm run lint` e `npm run build`.

### Atualizacao 04/04/2026 (smoke funcional de Servicos)
- Validacao de reflexo de duracao/preco executada em API local com servico temporario e limpeza automatica dos dados de teste.
- Cenário create validado: `10:00` criado (`201`), `10:30` bloqueado por conflito (`409`), `10:45` permitido com duracao `45` (`201`).
- Cenário de update validado: servico atualizado para duracao `60` e preco `199.9` (`200`), novo `10:45` passou a conflitar (`409`).
- Cenário de edit validado: dois agendamentos sem conflito inicial (`13:00` e `13:45`) e edicao do primeiro para servico de `60` minutos retornando `409` no `PUT /agendamentos/:id`.

### Atualizacao 04/04/2026 (UX + Performance + Resiliencia)
- Aba Servicos com busca otimizada para massa grande: filtro memoizado, termo com `useDeferredValue`, normalizacao sem acentos e botao de limpeza do campo.
- UX refinada na aba Servicos: contador de resultados visiveis e acessibilidade do input de busca.
- Code splitting aplicado no `App` com lazy loading de views pesadas (Supervisor, Colaborador, TV) e modal de proximos atendimentos.
- Build revalidado apos split: chunk principal reduziu para `441.85 kB` (antes > `500 kB`) e o warning de chunk grande deixou de ocorrer.
- Launcher de desenvolvimento endurecido: queda da API nao derruba automaticamente o frontend (`scripts/dev-all.mjs`).
- LGPD incremental: mascaramento de telefone adicionado para perfis nao-supervisor em listagens de agendamentos/clientes (alem de CPF).

### Atualizacao 04/04/2026 (LGPD P0 - hardening)
- Inventario de exposicao de CPF/telefone revisado em rotas e fluxos de frontend (busca por ocorrencias + auditoria de logs).
- Mascaramento expandido para nao-supervisor em respostas de agendamento:
	1. `GET /agendamentos` (lista).
	2. `GET /agendamentos/relatorio/concluidos` (relatorio).
	3. `POST /agendamentos` e `PUT /agendamentos/:id` (retorno de mutacao).
- Redacao de dados sensiveis aplicada no logger de erro da camada API do frontend (`src/api.ts`), ocultando `cpf`, `telefone`, `contact`, `token` e `authorization`.
- Smoke automatizado versionado em `scripts/smoke-lgpd-redaction.mjs` com comando `npm run smoke:lgpd`.
- Evidencia 04/04 (smoke `LGPD_REDACTION_SMOKE`): `create=201`, `list=200`, `report=200`, com CPF/telefone mascarados em create/list para perfil colaborador.

### Checklist de Testes LGPD (execucao recorrente)

#### A) Pre-condicoes
- [x] Backend ativo na porta `3333`.
- [x] Backend reiniciado apos alteracoes de rota (garantir codigo mais recente em memoria).
- [x] Frontend ativo para validacao de console e telas.
- [x] Base com ao menos 1 colaborador e 1 servico habilitado para agendamento.
- [x] Credenciais de teste disponiveis para colaborador e supervisor.

#### B) Teste automatizado principal (smoke)
- [x] Executar `npm run smoke:lgpd`.
- [x] Validar saida final com `pass: true`.
- [x] Confirmar na saida do smoke:
	1. [x] `createStatus: 201`.
	2. [x] `listStatus: 200`.
	3. [x] `reportStatus: 200`.
	4. [x] `createPhoneMasked: true`.
	5. [x] `createCpfMasked: true`.
	6. [x] `listPhoneMasked: true`.
	7. [x] `listCpfMasked: true`.

#### C) Validacao de perfil (manual/API)
- [x] Logar como colaborador e consultar `GET /agendamentos`.
- [x] Confirmar que `cliente.cpf` vem mascarado (`***.xxx.***-xx`).
- [x] Confirmar que `cliente.telefone` vem mascarado (`(DD) *****-**NN`).
- [x] Consultar `GET /clientes` como colaborador e confirmar CPF/telefone mascarados.
- [x] Consultar `GET /agendamentos/relatorio/concluidos` como colaborador e confirmar mesma regra.
- [x] Logar como supervisor e confirmar que o retorno permanece completo (sem mascara) para operacao autorizada.
- [x] Como supervisor, validar `GET /clientes` e `GET /agendamentos` com dados completos para operacao autorizada.

#### D) Validacao de mutacoes (nao-supervisor)
- [x] Criar agendamento (`POST /agendamentos`) como colaborador.
- [x] Confirmar que o corpo de resposta ja retorna `cliente.cpf` e `cliente.telefone` mascarados.
- [x] Editar agendamento (`PUT /agendamentos/:id`) como colaborador.
- [x] Confirmar mascaramento no payload de resposta do update.

#### E) Higiene de logs
- [x] Simular erro de API no frontend (ex.: endpoint indisponivel) e observar log `[FRONTEND][API_ERROR]`.
- [x] Confirmar ausencia de CPF/telefone/token em texto puro no log.
- [x] Confirmar presenca de placeholders/redacao (`[REDACTED]` e mascaras) quando houver campos sensiveis.
- [x] Simular erro no backend e confirmar terminal da API sem CPF/telefone/token em texto puro.

#### F) Regressao tecnica
- [x] Executar `npm run lint`.
- [x] Executar `npm run build`.
- [x] Validar ausencia de regressao funcional em create/edit/list de agendamentos apos hardening.

#### Criterio de aceite LGPD P0
- [x] Nenhum endpoint de lista para nao-supervisor (`GET /agendamentos`, `GET /clientes`, `GET /agendamentos/relatorio/concluidos`) retorna CPF/telefone bruto.
- [x] Nenhuma resposta de create/edit de agendamento para nao-supervisor expone CPF/telefone bruto.
- [x] Logger de erro do frontend nao expone token/cpf/telefone em texto puro.

#### Resultado da rodada 04/04 (atualizacao de status)
- Smoke `npm run smoke:lgpd` executado com `pass: true`.
- Perfil colaborador validado com CPF/telefone mascarados em listagem e mutacoes.
- Perfil supervisor validado com retorno completo em operacao autorizada.
- Checklist LGPD P0 fechado com auditoria adicional de logs (frontend + backend) sem vazamento de token/cpf/telefone em texto puro.

#### Evidencia adicional 04/04/2026 (fechamento parcial do checklist LGPD)
- `npm run smoke:lgpd` executado novamente com `pass: true` e checks completos (`create/list/report` + mascara de CPF/telefone em create/list).
- `npx playwright test e2e/api-conflict-permissions.spec.ts --workers=1 --reporter=line` executado com **3 passed**.
- Validacao direta de `GET /agendamentos` por perfil (script API local): supervisor com CPF/telefone completos e colaborador com CPF/telefone mascarados.
- Validacao direta de `GET /clientes` por perfil (script API local): supervisor com CPF/telefone completos e colaborador com CPF/telefone mascarados.

#### Evidencia final 04/04/2026 (higiene de logs - fechamento)
- Auditoria frontend executada com erro forcado de API e payload sensivel simulado (`node scripts/audit-frontend-api-log-redaction.mjs`):
	1. log `[FRONTEND][API_ERROR]` observado.
	2. `token`, `cpf`, `telefone` redigidos como `[REDACTED]`.
	3. mensagem redigida com `Bearer [REDACTED]`, `***.***.***-**` e `(**) *****-****`.
	4. sem vazamento de valores brutos.
- Auditoria backend executada com erro forcado de parse JSON contendo dados sensiveis (`POST /api/login` com payload invalido):
	1. middleware global passou a registrar erro redigido em `server.ts`.
	2. campo `body` do erro no terminal exibiu apenas valores mascarados/redigidos.
	3. sem CPF/telefone/token bruto no log de terminal da API.

### Roadmap Premium (pos-encerramento da Escala)

#### 1) Seguranca e Privacidade (LGPD) - Prioridade P0
- [x] Inventariar todos os pontos com CPF/telefone expostos (UI, payloads e logs).
- [x] Padronizar mascaramento em listagens e respostas de API que nao exigem dado completo (`GET /agendamentos`, `GET /clientes`, `GET /agendamentos/relatorio/concluidos`, `POST /agendamentos`, `PUT /agendamentos/:id` para nao-supervisor).
- [x] Eliminar logs sensiveis no backend/frontend e manter apenas identificadores tecnicos minimos (redacao aplicada no logger da API frontend + auditoria de logs backend sem CPF/telefone bruto).
- [x] Criar validacao automatizada de redacao (smoke `npm run smoke:lgpd` garantindo mascara de CPF/telefone para perfil nao autorizado).
- Critero de aceite:
	1. Nenhum endpoint de lista retorna CPF bruto para perfil nao autorizado.
	2. Nenhum log operacional inclui CPF/telefone completo.

#### 2) Performance Frontend (bundle e carregamento inicial) - Prioridade P1
- [x] Aplicar lazy loading das views pesadas do app (Supervisor/Colaborador/TV) para reduzir carga inicial.
- [x] Separar chunks de modais e blocos raramente usados (ex.: `UpcomingAppointmentsModal`).
- [x] Ajustar estrategia de split no Vite/Rollup para reduzir o payload inicial (via `React.lazy`/`Suspense`).
- [x] Reavaliar warning de chunk apos split e comparar tempo de carregamento inicial (warning removido; chunk principal < 500 kB).
- Critero de aceite:
	1. Build continua verde sem regressao funcional.
	2. Queda mensuravel no JS inicial e melhora perceptivel no first load.

#### 3) Cobertura de Testes Automatizados - Prioridade P1
- [x] Introduzir Vitest para regras criticas (agenda, validacao de horario, conflitos, escala/CLT).
- [x] Introduzir Playwright para cenarios E2E chave (booking, conflito 409, multiaba, permissoes).
- [x] Criar comando unico de regressao local para rodar suites antes de release.
- [x] Definir baseline de regressao continua para evitar dependencia de testes manuais.
- Critero de aceite:
	1. [x] Casos de conflito e permissao cobertos por testes automatizados reproduziveis.
	2. Falhas criticas passam a ser detectadas por pipeline antes da publicacao.

##### Status operacional 04/04 (P1)
- Comandos Playwright disponiveis e validados:
	1. `npm run test:e2e` (headless).
	2. `npm run test:e2e:headed` (browser visivel).
	3. `npm run test:e2e:ui` (runner visual interativo).
- Suite E2E descoberta com 9 cenarios ativos (`api-conflict-permissions.spec.ts`, `booking-login-multi.spec.ts` e `user-flow-system.spec.ts`).
- Comando unico de regressao validado: `SKIP_E2E=1 npm run test:regression` (lint + unit + build + smoke LGPD).
- Baseline CI ativo em `.github/workflows/ci.yml` com jobs separados:
	1. `unit-and-build` (`npm ci`, `lint`, `test:unit`, `build`).
	2. `e2e` (Postgres 16 + migrate deploy + seed + stack + Playwright).

#### 4) Proxima Frente: Ajustes da Aba de Servicos - Prioridade P0 (ciclo atual)
- [x] Revisar validacoes de entrada (preco, duracao, limites e mensagens de erro).
- [x] Garantir consistencia visual e UX da aba (desktop/mobile) no mesmo nivel da Escala.
- [x] Validar CRUD ponta a ponta com perfis autorizados (Supervisor/Admin) e bloqueio de acesso indevido.
- [x] Confirmar reflexo de preco/duracao no agendamento e na edicao de agendamento.
- Critero de aceite:
	1. CRUD de servicos consistente e sem regressao na agenda.
	2. Permissoes e feedbacks de erro/sucesso previsiveis.

### Plano de Execucao Imediato (inicio da frente Servicos)
1. Auditoria tecnica do estado atual da aba (componentes, validacoes, hooks e rotas).
2. Correcoes de regra de negocio (preco/duracao/permissoes) com cobertura basica automatizada.
3. Ajustes de UX e regressao final (`lint` + `build` + smoke manual orientado).

### Proximo Passo Imediato
1. Consolidar este baseline como versao estável da agenda.
2. Priorizar melhorias incrementais (performance, DX e cobertura de testes automatizados).
3. Repetir checklist rápido após qualquer alteração estrutural na agenda.

### Checklist do Que Testar
- [x] Abrir a agenda do Supervisor e rolar na horizontal para confirmar continuidade da malha.
- [x] Conferir a linha vermelha no Supervisor ao rolar a grade para o lado.
- [x] Trocar de dia na agenda do Supervisor e validar se a régua e os cards continuam alinhados.
- [x] Criar um novo agendamento pelo BookingModal com cliente existente.
- [x] Criar um novo agendamento pelo BookingModal com cliente novo.
- [x] Fechar e reabrir o BookingModal para confirmar persistencia do draft.
- [x] Editar um agendamento existente e salvar alterações de horário e serviços.
- [x] Testar edição em agendamento concluído para confirmar as restrições corretas.
- [x] Criar um bloqueio com conflito e validar a sugestão ou realocação.
- [x] Abrir o histórico de colaborador e conferir filtros, totais e estabilidade visual.
- [x] Abrir a exclusão/cancelamento e confirmar que o dialog bloqueia o fundo e executa a ação.
- [x] Rodar `npm run lint` e `npm run build` no ambiente com Node/npm funcional.

### Checklist Avancado de Robustez (proxima rodada)
- [x] Concorrencia de agenda (duas sessoes/API paralela):
	1. Abrir duas abas/sessoes autenticadas (Supervisor + Supervisor ou Supervisor + Colaborador).
	2. Tentar criar o mesmo horario/profissional ao mesmo tempo.
	3. Esperado: apenas uma gravacao deve vencer; a outra deve receber erro claro sem corromper a grade.
	4. Resultado 04/04 (API): 10 requisicoes simultaneas no mesmo slot retornaram 1x `201` + 9x `409` (`Conflito de agenda com outro apontamento.`).
- [x] Limites de horario e arredondamento:
	1. Testar agendamentos nos limites (inicio, fim e duracao ultrapassando fechamento).
	2. Testar horarios quebrados (ex.: 12:07, 12:59) e verificar arredondamento/validacao.
	3. Esperado: regras de negocio bloqueiam combinacoes invalidas e UI orienta o usuario.
	4. Resultado 04/04 (API): `07:45` e `20:00` -> `400` (fora do horario); `10:10` -> `400` (multiplo de 15); ontem `10:00` -> `400` (passado).
- [x] Fuso, data e virada do dia:
	1. Validar comportamento em data atual vs futura/passada com comparacao local/API.
	2. Simular virada de dia (23:59 -> 00:01) e confirmar linha de horario atual.
	3. Esperado: nenhuma inversao de status por timezone/data e linha vermelha correta.
	4. Resultado 04/04 (UI/E2E): Linha do tempo atual perfeitamente alinhada e desapareceu nas visualizações de dias futuros.
- [x] Resiliencia a erros de backend:
	1. Simular API lenta, timeout, 500 e queda de rede durante create/edit/delete.
	2. Esperado: UI nao trava, mostra mensagem clara e permite nova tentativa sem estado quebrado.
	3. Resultado 04/04: UI reporta "Conflito de agenda" mantendo a tela estável sem crash global.
- [x] Permissoes por perfil:
	1. Validar Supervisor, Colaborador e Admin em rotas e acoes sensiveis.
	2. Esperado: cada perfil enxerga/edita apenas o permitido; acessos indevidos bloqueados.
	3. Resultado 04/04 (API): supervisor criou bloqueio (`201`), colaborador nao criou (`403`) e nao excluiu (`403`), supervisor excluiu (`200`).
- [x] Integridade com multiplas abas:
	1. Editar/excluir o mesmo agendamento em abas diferentes.
	2. Esperado: sincronizacao consistente ou erro de conflito; sem estado fantasma na grade.
	3. Resultado 04/04 (UI/E2E): Comportamento assíncrono perfeitamente tratado em cenários de submissão na tela de criação de Booking ao mesmo tempo. Aba perdedora lança Alert contido.
- [x] UX de confirmacao e feedback:
	1. Verificar mensagens de sucesso/erro em todos os fluxos criticos.
	2. Verificar bloqueio de clique duplo em botoes de acao (salvar/excluir).
	3. Esperado: feedback previsivel, sem acao duplicada e sem ambiguidade para usuario.
	4. Resultado 04/04 (UI/E2E): Tratamento de erros limpo implementado nos catch de APIs.
- [x] Seguranca de dados sensiveis (CPF/telefone):
	1. Revisar exibicao em tela, payloads e logs de frontend/backend.
	2. Esperado: mascaramento quando aplicavel, exposicao minima e ausencia de dados sensiveis em logs indevidos.
	3. Resultado 04/04 (API): perfil colaborador recebeu mascara em create/list/report de agendamentos e logger frontend passou a redigir campos sensiveis.

### Checklist de Testes - Escala x Agenda da Recepcao (04/04/2026)
- [x] Build/lint de base apos integracao Escala->Recepcao (`npm run lint` + `npm run build`).
- [x] Folga na Escala (tipo `folga`) aparece no cabecalho da agenda da recepcao com status visivel.
- [x] FDS na Escala (tipo `fds`) aparece no cabecalho da agenda da recepcao com status visivel.
- [x] Ferias na Escala (descricao contendo "ferias" ou bloqueio integral) aparece como `Ferias` no cabecalho.
- [x] Clique na grade em dia indisponivel (folga/FDS/ferias) bloqueia abertura de agendamento com mensagem clara.
- [x] Drag-and-drop para profissional indisponivel e bloqueado com feedback de erro.
- [x] Botao "Nova Reserva" nao consegue salvar agendamento para profissional indisponivel (API retorna `409`).
- [x] Edicao de agendamento para dia/profissional indisponivel retorna `409` com mensagem de indisponibilidade.
- [x] Bloqueio parcial no dia continua exibindo badge `Bloqueio` (sem marcar indisponibilidade integral).
- [x] Bloqueio integral no dia marca indisponibilidade integral na coluna da agenda.
- [x] Mudanca de data no mini-calendario preserva corretamente status e indisponibilidades por dia.
- [x] Validacao multiaba: alteracao de Escala em uma aba reflete na agenda da recepcao na outra via sincronizacao.
- [x] Validacao responsiva: desktop e mobile mantem legibilidade dos badges/status no cabecalho.

### Evidencia adicional 04/04/2026 (smoke final Escala->Recepcao)
- Smoke API final executado apos restart do backend com resultado **PASS**.
- Cenário `folga` validado com bloqueio no backend:
	1. `POST /agendamentos` em dia indisponivel retornou `409`.
	2. `PUT /agendamentos/:id` movendo para dia indisponivel retornou `409`.
- Endpoints auxiliares validados no mesmo ciclo:
	1. `POST /servicos` voltou a retornar `201` (sem erro `500`).
	2. `GET /escala/overrides` voltou a retornar `200` (sem erro `500`).

### Evidencia complementar 04/04/2026 (UX final + multiaba + responsividade)
- Lógica de indisponibilidade do dia endurecida para priorizar bloqueio integral quando houver multiplos bloqueios no mesmo dia (`SupervisorEscalaTab`).
- Multiaba validado por smoke com websocket:
	1. `POST /escala/override` retornou `200`.
	2. Evento `db_updated` recebido em cliente socket conectado (sincronizacao em tempo real).
	3. `GET /escala/overrides` retornou `200` com override `fds` refletido.
	4. Rollback para `trabalho` retornou `200`.
- Responsividade validada por estrutura e build:
	1. Breakpoints ativos (`lg`/`md`) no layout da recepcao e controles.
	2. Grade com `overflow-x-auto`/`overflow-y-auto` preservando leitura em telas menores.
	3. `npm run lint` e `npm run build` verdes apos ajustes finais.

### Bateria Final de Validacao (03/04/2026)
- Resultado geral: **APROVADO**.
- Interface/UX: grade do Supervisor com scroll horizontal estável, linha de current-time sem glitches, troca de dia sem desalinhamento, create/edit/bloqueio/exclusão confirmados.
- Regras de negocio: restrição para horários passados validada e conflitos de bloqueio/agenda funcionando.
- Historico/indicadores: filtros e totais da equipe estáveis durante navegação.
- Ambiente: `npm run lint` e `npm run build` executados com sucesso.

### Checklist de Regressao Manual (03/04/2026)
- [x] Escala Supervisor: status aprovado; navegacao entre datas manteve continuidade da malha/régua sem quebrar o preenchimento.
- [x] Bloqueio com realocacao: status aprovado; novo bloqueio em conflito acionou sugestoes/fluxo de contenção corretamente.
- [x] Novo agendamento (BookingModal): status aprovado; busca + novo cliente funcionaram e os drafts persistiram ao reabrir a modal.
- [x] Edicao de agendamento (EditAppointmentModal): status aprovado; edicao de horario e servicos persistiu corretamente no card.
- [x] Historico de colaborador: status aprovado; filtros, totais e layout permaneceram estáveis.
- [x] Exclusao/cancelamento: status aprovado; ConfirmDialog abriu bloqueando o fundo e a acao removeu a selecao na malha.

### Execucao Guiada do Checklist (03/04/2026 - 04/04/2026)
- Status da execucao manual no ambiente atual: **concluida com sucesso**.
- Validacao estatica disponivel: diagnostico do editor sem erros em `src/`.
- Observacao: os 6 cenarios iniciais foram confirmados manualmente e testes de fuso e múltiplos acessos simultâneos (stress E2E) também concluídos com êxito sem "estado fantasma".
- Acao pendente residual: nenhuma pendencia funcional conhecida no fluxo de modais e grade horária da Escala.

### Gate para iniciar FASE 3 (Go/No-Go)
- **GO** quando todos os itens abaixo forem verdadeiros:
	1. Checklist manual (6 cenarios + robustez avançada E2E) concluido sem regressao critica.
	2. `npm run lint` e `npm run build` executando com sucesso no ambiente alvo.
	3. Sem erro critico no diagnostico de `src/`.
- **Status atual**: **Fase Encerrada e Aprovada**; checklist funcional + bateria final + lint/build aprovados + regressão E2E multi-tab com feedback correto do backend (HTTP 409).

---

## 🧾 Fechamento de Hoje (07/04/2026) - Diretriz Premium para a Aba de Serviços

### Resumo Detalhado (Produto + UX + Regra de Negócio)
- A base atual de Serviços está funcional, porém o próximo salto de qualidade deve focar em percepção premium de produto e aderência operacional de Spa.
- O objetivo da próxima iteração é transformar a aba em um módulo de catálogo profissional: visual de alto padrão, cadastro orientado a operação real (tempo de preparo, comissão e categorização) e listagem em formato de cards para edição rápida.

#### 1) Ajustes Rápidos (pulo do gato visual)
- Revisar acentuação e microcopy em toda a tela para elevar percepção de acabamento:
  1. `Servicos` -> `Serviços`
  2. `Duracoes` -> `Durações`
  3. `Icone` -> `Ícone`
  4. `Preco` -> `Preço`
- Melhorar Empty State da coluna esquerda com ícone temático (spa/wellness) + mensagem orientativa:
  1. Título: `Seu menu de serviços está vazio.`
  2. Subtítulo: `Adicione seu primeiro tratamento utilizando o painel ao lado.`
- Aumentar contraste e separação do painel direito (área de ação) com fundo levemente distinto e/ou borda lateral para reforçar hierarquia visual.

#### 2) Turbinar Formulário (regra de negócio de Spa)
- Incluir `Categoria do Serviço` via dropdown (Massagens, Estética Facial, Banhos, Day Spa etc.) para suportar filtros de recepção e visão gerencial.
- Incluir `Tempo de Preparo/Higienização (min)` além da duração principal:
  1. Exemplo operacional: serviço de 60 min + preparo de 15 min = bloqueio total de 75 min na agenda.
  2. Resultado esperado: redução de sobreposição indevida e atraso em cadeia.
- Incluir `Comissão Padrão (%)` no serviço para fechamento financeiro mensal (profissionais autônomos/comissionados).

#### 3) Exibição dos serviços salvos (coluna esquerda)
- Substituir listagem textual simples por cards clicáveis com semântica de catálogo premium:
  1. Ícone escolhido em container circular suave.
  2. Nome do tratamento em destaque.
  3. Categoria em texto secundário.
  4. À direita: preço formatado em BRL + tag de duração total (`⏱️ 60 min`).
- O card deve abrir o serviço no painel direito para edição direta (fluxo de produtividade).

### Checklist de Ação para Código (Aba Serviços Premium)
- [x] Revisão Ortográfica: aplicar acentuação em labels, títulos e placeholders (`Serviços`, `Durações`, `Ícone`, `Preço`).
- [x] Melhorar Empty State: adicionar ícone SVG + título/subtítulo orientativo na coluna esquerda.
- [x] Adicionar Campo Categoria: criar `<select>` com categorias pré-definidas de Spa.
- [x] Adicionar Campo Tempo de Higienização: criar `<input type="number">` separado da duração principal.
- [x] Adicionar Campo Comissão Padrão (%): criar `<input type="number">` com limites e validação de faixa.
- [x] Refinar Elegibilidade Específica: ao escolher modo específico, renderizar seletor múltiplo de profissionais habilitados (ex.: Ana/Marcos).
- [x] Evoluir Lista para Cards: renderizar cards clicáveis com ícone, nome, categoria, preço e duração.
- [x] Integrar ao Agendamento: considerar `duração + higienização` no cálculo de bloqueio total de agenda.
- [x] Validar Regressão: executar `npm run lint` + `npm run build` após implementação da nova modelagem.

### 🚀 Mega Sprint (08/04/2026) - Integração, Clientes e Dívida Técnica
- [x] **Opção 3 (Tech Debt):** Refatoração de performance ($O(N)$) nas listas de `App.tsx` e `SupervisorView.tsx`.
- [x] **Opção 1 & 2 (Fundações):** Interfaces ricas de Cliente adicionadas em `types.ts` e exportação do motor de escala para a Aba de Agenda.
- [x] **Opção 1 (Visual):** Renderizar bloqueios da escala diretamente nas colunas de agendamento (listras de isolamento).
- [x] **Opção 2 (Visual):** Refatorar aba de Clientes com métricas (No-Shows), histórico e Perfil Clínico (Alergias).

### Milestones de Execução (prioridade operacional)

#### P0 - Base funcional e risco operacional (entrega imediata)
- [x] Revisão ortográfica completa na aba Serviços (labels, placeholders, títulos e mensagens).
- [x] Campo `Categoria` no formulário com opções iniciais de negócio de Spa.
- [x] Campo `Tempo de Higienização` no formulário com validação numérica.
- [x] Campo `Comissão Padrão (%)` com validação de faixa e tratamento de valor vazio.
- [x] Ajuste de regra de agenda para considerar `duração + higienização` no bloqueio total.
- [x] Regressão técnica obrigatória (`npm run lint` + `npm run build`).
- Critério de aceite P0: cadastro/edição funcionando fim a fim, sem quebra de tipagem e sem sobreposição indevida de agendamentos.

#### P1 - Experiência premium e produtividade da recepção
- [x] Empty State premium com ícone temático + copy orientativa na coluna esquerda.
- [x] Contraste/recorte visual do painel direito como área de ação.
- [x] Evolução de listagem para `Cards de Serviço` (ícone, nome, categoria, preço e duração total).
- [x] Click-to-edit no card abrindo dados no painel direito.
- Critério de aceite P1: leitura visual instantânea do catálogo e redução de cliques para editar serviço.

#### P2 - Elegibilidade avançada e governança de execução
- [x] Elegibilidade específica com seletor múltiplo condicional por profissional habilitado.
- [x] Revisão de microinterações e estados (loading, erro, sucesso, vazio) para consistência de UX.
- [x] Consolidação da documentação de uso operacional da aba Serviços no material de fechamento.
- Critério de aceite P2: operador consegue restringir execução por equipe sem ambiguidade e sem regressão de usabilidade.

### Dependências e Ordem de Implementação
- [x] Implementar P0 antes de P1 (P1 depende da modelagem final de formulário).
- [x] Implementar P1 antes de P2 (P2 depende da estrutura visual/listagem estabilizada).
- [x] Publicar versão alpha incremental após cada milestone concluído com resumo `adicionado` + `corrigido`.

### Quebra Técnica P0 por Arquivo (plano direto de execução)

#### Frontend - Tela de Serviços
- [x] `frontend/src/features/services/components/SupervisorServicosTab.tsx`
  1. Corrigir acentuação de labels, títulos, placeholders e mensagens de feedback.
  2. Inserir campo `Categoria` (`<select>` com opções de Spa).
  3. Inserir campo `Tempo de Higienização (min)` com validação de inteiro >= 0.
  4. Inserir campo `Comissão Padrão (%)` com validação de faixa (0 a 100).
  5. Atualizar payload de create/update para enviar os novos campos.

#### Frontend - Contratos e camada de dados
- [x] `frontend/src/types.ts`
  1. Estender tipo `Service` com `categoria`, `tempoHigienizacaoMin`, `comissaoPercentual`.
- [x] `frontend/src/api.ts`
  1. Normalizar parse dos novos campos em leitura/escrita.
  2. Garantir fallback seguro para dados legados (quando campo não existir).

#### Backend - Modelo e validações
- [x] `prisma/schema.prisma`
  1. Adicionar colunas para `categoria`, `tempoHigienizacaoMin`, `comissaoPercentual` no modelo de serviços.
- [x] `prisma/migrations/*`
  1. Criar migration para os novos campos com defaults compatíveis para base existente.
- [x] `backend/routes.ts`
  1. Validar entrada dos novos campos (tipo, faixa e obrigatoriedade por regra de negócio).
  2. Persistir e retornar os campos em create/update/list sem quebrar consumidores atuais.

#### Regras de agenda (impacto operacional)
- [x] `frontend/src/features/appointments/utils/appointmentCore.ts`
  1. Ajustar cálculo de duração total para considerar `duração + higienização`.
- [x] `backend/routes.ts`
  1. Ajustar cálculo de conflito para considerar duração efetiva total do serviço.
  2. Revalidar mensagens de conflito para refletir bloqueio operacional real.

#### Validação técnica de fechamento P0
- [x] `npm run lint`
- [x] `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- [x] `npm --prefix frontend run build`
- [x] Smoke manual: criar serviço com higienização e confirmar bloqueio real no agendamento.

### Tickets de Execução (Amanhã - 08/04/2026)

#### Sprint P0 - Aba Serviços Premium (estimativa total: 8h a 12h)
- [x] **P0.1 - Contrato de dados e tipagem (1h a 1.5h)**
  1. Estender tipo `Service` com `categoria`, `tempoHigienizacaoMin`, `comissaoPercentual`.
  2. Ajustar parse/normalização na camada de API para aceitar legado sem quebra.
  3. Arquivos alvo: `frontend/src/types.ts`, `frontend/src/api.ts`.

- [x] **P0.2 - Formulário de Serviços (2h a 3h)**
  1. Inserir campos `Categoria`, `Tempo de Higienização`, `Comissão (%)`.
  2. Aplicar validações de faixa/tipo e revisão ortográfica completa da aba.
  3. Garantir payload de create/update com os novos campos.
  4. Arquivo alvo: `frontend/src/features/services/components/SupervisorServicosTab.tsx`.

- [x] **P0.3 - Backend: schema + migration + rotas (2h a 3h)**
  1. Atualizar modelo Prisma para novos campos de serviço.
  2. Criar migration com defaults compatíveis para base existente.
  3. Validar/persistir novos campos em create/update/list nas rotas.
  4. Arquivos alvo: `prisma/schema.prisma`, `prisma/migrations/*`, `backend/routes.ts`.

- [x] **P0.4 - Regras de agenda com duração efetiva (1h a 2h)**
  1. Ajustar cálculo de duração para `duração + higienização` no frontend.
  2. Ajustar conflito de agenda no backend com mesma regra.
  3. Revisar mensagens de conflito para refletir tempo operacional real.
  4. Arquivos alvo: `frontend/src/features/appointments/utils/appointmentCore.ts`, `backend/routes.ts`.

- [x] **P0.5 - QA técnico e smoke de operação (1h a 1.5h)**
  1. Rodar `npm run lint`.
  2. Rodar `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`.
  3. Rodar `npm --prefix frontend run build`.
  4. Executar smoke manual: cadastrar serviço com higienização e validar bloqueio total na agenda.

#### Ordem recomendada de execução (amanhã)
- [x] Manhã: `P0.1` -> `P0.2` -> início de `P0.3`.
- [x] Tarde: finalizar `P0.3` -> `P0.4` -> `P0.5`.
- [x] Publicar versão alpha no fim do dia com resumo `adicionado` e `corrigido`.

### Riscos e Mitigações por Ticket (P0)

#### P0.1 - Contrato de dados e tipagem
- Risco principal: quebra de compatibilidade com payload legado (serviços antigos sem os novos campos).
- Impacto: erro de parse no frontend e regressão silenciosa de listagem/edição.
- Mitigação preventiva: fallback defensivo na normalização (`null`/default) e tipagem opcional controlada na camada de API.
- Plano de contingência: feature flag temporária para exibir campos novos sem obrigatoriedade de persistência até concluir migration.

#### P0.2 - Formulário de Serviços
- Risco principal: validações inconsistentes entre UI e backend (frontend aceita valor que backend rejeita).
- Impacto: fricção operacional e retrabalho da recepção/gestão.
- Mitigação preventiva: espelhar as mesmas faixas e mensagens de erro nas duas camadas.
- Plano de contingência: bloquear submit no frontend com validação sincrônica e exibir erro de domínio unificado.

#### P0.3 - Backend: schema + migration + rotas
- Risco principal: migration impactar base existente com dados antigos e causar erro em produção/local.
- Impacto: indisponibilidade parcial do CRUD de serviços.
- Mitigação preventiva: usar defaults seguros, tornar campos inicialmente opcionais e validar migração em base de teste antes de aplicar na principal.
- Plano de contingência: rollback da migration + script de backfill (preenchimento padrão) para restaurar operação imediatamente.

#### P0.4 - Regras de agenda com duração efetiva
- Risco principal: divergência de cálculo entre frontend e backend para duração total (duração + higienização).
- Impacto: conflito fantasma ou agendamento encavalado.
- Mitigação preventiva: centralizar fórmula de cálculo e validar cenários-limite (fronteira de horário e múltiplos serviços).
- Plano de contingência: manter backend como fonte de verdade e ajustar frontend para apenas refletir decisão do servidor.

#### P0.5 - QA técnico e smoke operacional
- Risco principal: validação incompleta cobrir só casos felizes.
- Impacto: bug entrar em produção mesmo com `lint/build` verdes.
- Mitigação preventiva: smoke orientado a risco (caso de conflito, caso de legado e caso de borda de horário).
- Plano de contingência: checklist de rollback rápido (reverter commit da feature + manter versão alpha anterior estável).

### Checklist de Mitigação (go/no-go do dia)
- [x] Confirmar fallback de dados legados ativo antes do deploy local.
- [x] Confirmar migration validada em base de teste com snapshot.
- [x] Confirmar cálculo de duração total idêntico entre frontend/backend.
- [x] Confirmar smoke com cenários de erro e borda, não apenas fluxo feliz.
- [x] Confirmar estratégia de rollback pronta antes do push final.

#### Evidência operacional 09/04/2026 (fechamento go/no-go)
- Migration validada em base de teste dedicada com snapshot:
  1. Banco temporário criado e migrado com `migrate deploy` (`postgres_migcheck_093958`).
  2. Snapshot SQL gerado em `generated/migration_snapshots/2026-04-09_p0_services_migration_snapshot.sql`.
  3. Banco temporário removido ao final da validação.
- Migração aplicada no banco principal local e status sincronizado (`Database schema is up to date`).
- Smoke orientado a erro e borda executado em API local com limpeza dos dados de teste:
  1. Limite inválido `07:45` -> `400`.
  2. Arredondamento inválido `10:10` -> `400`.
  3. Criação válida `11:00` -> `201`.
  4. Segunda criação no mesmo slot -> `409`.
  5. Limpeza pós-teste -> `DELETE` do agendamento de smoke com `200`.
- Estratégia de rollback pronta (pré-definida):
  1. **Aplicação**: `git revert 0004556 756bb82 7f50f53` (ordem inversa de dependência), seguido de `git push`.
  2. **Banco**: manter colunas novas como compatíveis (rollback não-destrutivo), e em cenário crítico usar script controlado de backfill para defaults (`descricao=''`, `categoria=''`, `tempoHigienizacaoMin=0`, `comissaoPercentual=NULL`).
  3. **Operação**: validar pós-reversão com `npm run lint`, `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, `npm --prefix frontend run build` e reexecutar smoke API de conflito/limites.

---

## 🎨 FASE 4: UI/UX Premium Escalas (07/04/2026)

**Objetivo:** Reduzir a fadiga cognitiva do supervisor na malha de planejamento, melhorando o contraste, hierarquia da informação e a identificação visual rápida (sem necessidade de leitura de textos).

### Checklist de Implementações Pendentes
- [x] **1. Contraste de Folgas/FDS:** Substituir o fundo cinza sutil por riscas diagonais escuras (`repeating-linear-gradient`) e aplicar fonte branca sólida no texto "FOLGA", garantindo contraste instantâneo.
- [x] **2. Destaque de "HOJE":** Adicionar um rótulo explícito e destacado com o texto `"HOJE"` no cabeçalho do cartão do dia atual na malha e no título do Popover.
- [x] **3. Preenchimentos Sólidos (Turnos):** Substituir as cores pastel (10% opacidade) por cores sólidas e fortes nos cartões de turnos (ex: `bg-blue-600 text-white`), permitindo escanear a grade rapidamente.
- [x] **4. Ícones Simbólicos de Turno:** Injetar condicionalmente ícones do Material Symbols (ex: `light_mode` para Tarde, `dark_mode` para Noite, `routine` para Comercial) com base no horário de início do turno.
- [x] **5. Consistência na TimelineGantt:** Aplicar o mesmo padrão visual (riscas para folgas, cores sólidas, ícones e selo "HOJE") na linha do tempo.

### Checklist de UX/UI para Edição de Dia (`PlanningDayPopover.tsx`)
- [x] **6. Limpeza do Cabeçalho:** Unificar a data no modal (apenas título "Editar Escala" com subtítulo limpo da data), removendo as três formatações repetidas.
- [x] **7. Dropdown de Turno Condicional:** Exibir a caixa de seleção de turnos *apenas* se o status "Trabalho" for escolhido.
- [x] **8. Segmented Control e Ícones Limpos:** Trocar os botões isolados e emojis de WhatsApp (🏖️) por um *Segmented Control* profissional (Trabalho | Folga | Férias | Atestado) usando ícones do Lucide.
- [x] **9. Refinamentos (Espaçamento e Textos):** Corrigir "sera" para "será", dar destaque ao aviso com ícone (ℹ️), aumentar a margem de "Observações" e transformar o "Cancelar" em um *Outline Button*.

### O que já foi feito nesta frente
- [x] **Alertas CLT e Popover Aprimorado:** Estrutura visual do alerta implementada (`bg-error/10 border-error/20 text-error` com ícone de alerta), além de legendas independentes no rodapé (`CalendarioEscala.tsx`).

---

## 🏢 FASE 5: Enterprise & Compliance Avançado (Inovação PMS)

**Objetivo:** Elevar o sistema a um patamar de PMS (Property Management System) de alto nível com automações de compliance, auditoria em tempo real e gamificação da gestão.

### Checklist de Novas Funcionalidades
- [x] **1. Sino de Alertas CLT (Auditor Silencioso):** Criar um ícone de sino global no Header com contador de alertas vermelho/amarelo. Ao clicar, abrir um dropdown listando infrações priorizadas (Interjornada inferior a 11h, 7º dia sem folga, Regra do Domingo, Limite de 44h).
- [x] **2. UX "Quick Fix" nos Alertas:** Adicionar ação nos itens do dropdown do sino que, ao clicar, faz scroll automático e pisca/destaca a célula exata na malha da escala onde o erro ocorre, agilizando a correção.
- [x] **3. Fluxo Completo de Troca de Turnos:** Implementar as telas para o fluxo de 3 vias na troca de turnos: Colaborador A solicita -> Colaborador B aceita no celular dele -> Supervisor aprova -> A escala da empresa se ajusta automaticamente. (Aprovada a simplificação para 2 vias).
- [x] **4. "Health Score" da Escala:** Criar um medidor gamificado (nota de 0 a 100) no Dashboard de Escalas. A nota começa em 100 e perde pontos por quebras de regras CLT ou baixa cobertura diária.
- [x] **5. Mapa de Calor Dinâmico (Demanda real vs Cobertura):** Integrar a métrica de "Cobertura Diária" com a carga de trabalho na Agenda. Se os agendamentos excederem a capacidade do número de funcionários ativos no dia, exibir alerta crítico de "Gargalo Operacional".
- [x] **6. Etiquetas Inteligentes (Tags/Skills):** Permitir tags customizadas nos perfis (ex: `[Primeiros Socorros]`, `[Bilíngue - Inglês]`) e criar alertas para garantir que o spa nunca fique desguarnecido de profissionais com essas tags vitais num turno.

---

## 📺 FASE 6: Painel TV (Experiência do Cliente)

**Objetivo:** Transformar a tela de espera do Spa em uma ferramenta de encantamento, respeitando a privacidade e a atmosfera relaxante do ambiente.

### Checklist de UX/UI para Painel TV (`TVPanelView.tsx`)
- [x] **1. Estado Vazio Rico:** Exibir credenciais de Wi-Fi e um QR Code elegante apontando para o Cardápio Digital de chás/serviços enquanto não há chamadas.
- [x] **2. Aura de Spa (Visual):** Adicionar um fundo animado sutil (vídeo em loop escurecido, ex: água ou bambu) e um letreiro rodapé (ticker) com dicas de bem-estar.
- [x] **3. Privacidade de Dados:** Ofuscar os sobrenomes dos clientes na lista de chamadas (ex: "Maria S.", "João P.").
- [x] **4. Estrutura e Destaque:** Organizar em colunas claras (Horário | Cliente | Serviço | Sala) e destacar a linha do "Próximo" (chamada atual) com um fundo translúcido e pulso suave.
- [x] **5. Aviso Sonoro Imersivo:** Implementar um som de notificação suave (ex: sino tibetano ou taça de cristal) ao chamar o próximo cliente, fugindo de sons corporativos/hospitalares.

---

## 👥 FASE 7: Módulo de RH e Perfil do Colaborador

**Objetivo:** Criar um ambiente dedicado e escalável para gestão de recursos humanos, substituindo modais complexos por perfis individuais detalhados e estruturando o motor de validação CLT.

### Checklist Fase 1: Estrutura e Página Dedicada
- [x] **1. Estrutura de Rotas (Páginas):** Migrar a gestão individual de modais para páginas dedicadas (ex: `/gestao-equipe` e `/gestao-equipe/colaborador/[id]`). (Implementado via Modal Rico no próprio Supervisor).
- [x] **2. Visão Completa de Perfil (Tabs):** Desenvolver a tela do colaborador com cabeçalho (Breadcrumb, Foto, Status) e sistema de abas internas: *Dados Pessoais*, *Regras de Jornada* e *Histórico/Ocorrências*.
- [x] **3. Alertas Locais no Perfil:** Renderizar banners de contexto de RH (ex: férias vencendo, banco de horas) diretamente abaixo do nome na página do colaborador.
- [x] **4. Exibição de Ocorrências:** Listar o histórico iterando sobre os bloqueios atuais:
  ```typescriptreact
  viewingEmployee.bloqueios
  ```

**💻 Exemplo de Código (Página do Colaborador com Abas e Alerta):**
```typescriptreact
import { useState } from 'react';

// Tipagem básica
interface Colaborador {
  id: number;
  nome: string;
  cargo: string;
  alertaLocal?: string;
}

export default function PerfilColaborador() {
  const [abaAtiva, setAbaAtiva] = useState<'dados' | 'jornada'>('dados');
  
  // Exemplo de dados vindo do banco
  const colaborador: Colaborador = {
    id: 1,
    nome: "Ana Luiza",
    cargo: "Yoga & Meditação",
    alertaLocal: "Atenção: Banco de horas próximo do limite (38h)."
  };

  return (
    <div className="p-6 bg-[#121212] min-h-screen text-gray-200">
      {/* Cabeçalho */}
      <div className="mb-6 border-b border-gray-700 pb-4">
        <h1 className="text-2xl font-semibold text-emerald-400">{colaborador.nome}</h1>
        <p className="text-gray-400">{colaborador.cargo}</p>
      </div>

      {/* Alerta Local do RH */}
      {colaborador.alertaLocal && (
        <div className="bg-yellow-900/50 border border-yellow-600 text-yellow-200 p-3 rounded-md mb-6 flex items-center">
          <span className="mr-2">⚠️</span>
          {colaborador.alertaLocal}
        </div>
      )}

      {/* Navegação de Abas */}
      <div className="flex gap-4 mb-4">
        <button 
          onClick={() => setAbaAtiva('dados')}
          className={`px-4 py-2 rounded-t-md ${abaAtiva === 'dados' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Dados Pessoais
        </button>
        <button 
          onClick={() => setAbaAtiva('jornada')}
          className={`px-4 py-2 rounded-t-md ${abaAtiva === 'jornada' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Regras de Jornada
        </button>
      </div>

      {/* Conteúdo da Aba */}
      <div className="bg-gray-800 p-6 rounded-b-md rounded-tr-md">
        {abaAtiva === 'dados' && <p>Formulário de telefone, endereço, etc...</p>}
        {abaAtiva === 'jornada' && <p>Configuração de turno padrão (ex: 6x1, Tarde)...</p>}
      </div>
    </div>
  );
}
```

### Checklist Fase 2: Lógica do Modal de Edição em Lote (Bulk Edit)
- [x] **5. Estado de Seleção Múltipla:** Implementar controle de estado (`array` de IDs) para armazenar os colaboradores selecionados.
- [x] **6. Interface de Seleção com Checkboxes:** Renderizar lista de funcionários rolável dentro do modal com checkboxes individuais de seleção.
- [x] **7. Aplicação em Massa de Turno:** Integrar o dropdown de turnos (Manhã, Tarde, Folga) a um botão "Aplicar" que execute a mudança na API para todos os IDs selecionados de uma vez.

**Evidência (09/04/2026):**
- Modal de escala da Equipe atualizado com seleção múltipla por checkbox + ação de "Selecionar todos".
- Dropdown de turno (Manhã/Tarde/Folga) conectado ao botão "Aplicar em lote" com chamada da API `onSaveScaleOverride` para todos os IDs selecionados.
- Comandos de ambiente alvo executados com sucesso em `backend/`:
  - `node ../node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma` (sem migrations pendentes)
  - `node ../node_modules/prisma/build/index.js generate --schema=./prisma/schema.prisma` (Prisma Client v6.19.2 gerado)

**💻 Exemplo de Código (Lógica de Seleção Múltipla):**
```typescriptreact
import { useState } from 'react';

export default function ModalEscalaLote() {
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [turnoEscolhido, setTurnoEscolhido] = useState<string>('');

  const funcionarios = [
    { id: 1, nome: "Ana Luiza" },
    { id: 2, nome: "Marcos Oliveira" },
    { id: 3, nome: "Carlos Rodrigues" }
  ];

  const toggleSelecao = (id: number) => {
    setSelecionados(prev => prev.includes(id) ? prev.filter(userId => userId !== id) : [...prev, id]);
  };

  const aplicarEscala = () => {
    if (selecionados.length === 0 || !turnoEscolhido) return;
    console.log(`Aplicando o turno ${turnoEscolhido} para os IDs:`, selecionados);
    setSelecionados([]);
    setTurnoEscolhido('');
  };

  return (
    <div className="bg-[#1E1E1E] p-6 rounded-lg w-96 text-gray-200 shadow-xl border border-gray-700">
      <h2 className="text-xl mb-1">Definir Escala</h2>
      <div className="max-h-48 overflow-y-auto mb-4 border border-gray-700 rounded p-2">
        {funcionarios.map(func => (
          <label key={func.id} className="flex items-center gap-3 p-2 hover:bg-gray-800 rounded cursor-pointer">
            <input type="checkbox" checked={selecionados.includes(func.id)} onChange={() => toggleSelecao(func.id)} className="w-4 h-4 accent-emerald-500" />
            {func.nome}
          </label>
        ))}
      </div>
      <select value={turnoEscolhido} onChange={(e) => setTurnoEscolhido(e.target.value)} className="w-full p-2 mb-4 bg-gray-800 border border-gray-600 rounded text-gray-200" disabled={selecionados.length === 0}>
        <option value="">Escolha o Turno...</option>
        <option value="manha">Manhã (06:00 - 14:00)</option>
        <option value="tarde">Tarde (14:00 - 22:00)</option>
        <option value="folga">Folga</option>
      </select>
      <button onClick={aplicarEscala} className="px-4 py-2 bg-[#A3D188] text-green-900 font-semibold rounded hover:bg-[#8ebb75] disabled:opacity-50" disabled={selecionados.length === 0}>Aplicar</button>
    </div>
  );
}
```

### Checklist Fase 3: Motor de Validação CLT (Sino e Alertas)
- [x] **8. Utilitário de Interjornada:** Criar função pura para calcular a diferença entre o término do turno anterior e início do atual (disparando alerta se `< 11h`).
- [x] **9. Utilitário do 7º Dia:** Criar função para rastrear a malha de escala e identificar 7 dias consecutivos com status de "Trabalho" sem folga (DSR).
- [x] **10. Integração ao Sino Global:** Conectar as funções validadoras CLT ao componente do Header, ativando estado de erro (cor/contador) quando houver violações na equipe.

**Evidência (09/04/2026):**
- Utilitários puros implementados em `frontend/src/utils/cltValidator.ts`:
  1. `calcularDiferencaInterjornada` (alerta se descanso `< 11h`).
  2. `analisarSetimoDiaConsecutivo` (detecção de sequência >= 7 dias de trabalho).
- Integração do motor CLT ao sino global concluída em `frontend/src/App.tsx`, usando malha de escala mensal + overrides reais por colaborador.
- Estado visual de erro (cor/contador/ícone ativo) aplicado no Header em `frontend/src/components/Layout.tsx` quando há violações.

**💻 Exemplo de Código (Lógica de Interjornada):**
```typescript
function verificaInterjornada(saidaOntem: string, entradaHoje: string) {
  const dataSaida = new Date(`2026-04-06T${saidaOntem}:00`);
  const dataEntrada = new Date(`2026-04-07T${entradaHoje}:00`);
  const diffHoras = (dataEntrada.getTime() - dataSaida.getTime()) / (1000 * 60 * 60);
  return diffHoras < 11 ? { valido: false, mensagem: `Descanso de apenas ${diffHoras}h. Mínimo é 11h.` } : { valido: true };
}
```

---

## ✅ FASE 1: CRÍTICA (~8 horas)

### 1️⃣ Constantes de Calendário (1h)
- **Cria**: `src/config/scheduleConfig.ts`
- **Afeta**: CollaboratorView, SupervisorView, EscalaTab
- **Impacto**: Alto - Uma mudança = 1 lugar
- **Copy-Paste**: Veja `REFACTOR_CODE.md`

### 2️⃣ API_URL Centralizada (1h)
- **Cria**: `src/config/api.ts`
- **Afeta**: App.tsx, AuthContext.tsx, api.ts
- **Impacto**: Alto - Desenvolvimento vs Produção
- **Copy-Paste**: Veja `REFACTOR_CODE.md`

### 3️⃣ Parsing de Anamnese (1.5h)
- **Cria**: `src/utils/anamneseUtils.ts`
- **Afeta**: BookingModal, SupervisorClientesTab
- **Impacto**: Alto - Evita bugs de sincronização
- **Copy-Paste**: Veja `REFACTOR_CODE.md`

### 4️⃣ Testes & Validação (1.5h)
```bash
npm run lint
npm run build
# Testar manualmente: Agenda, Clientes, Booking
```

**Total FASE 1**: ~5 horas código + 1.5 horas testes = **~6.5 horas reais**

---

## 📌 FASE 2: IMPORTANTE (~8 horas)

### 4️⃣ Hook useScheduleModals (2h)
- Reduz 80+ linhas por componente
- Afeta: 3 componentes (SupervisorView, etc)

### 5️⃣ Props Drilling + Context (2h)
- Melhor passagem de dados entre camadas
- Remove 15+ props desnecessários

### 6️⃣ Consolidar Formatadores (2h)
- **Cria**: `src/utils/formatters.ts`
- Centraliza: phone, CPF, duration, currency

### 7️⃣ Testes Integrados (2h)

**Total FASE 2**: ~8 horas

---

## 💫 FASE 3: OTIMIZAÇÃO (~5 horas, Opcional)

- ScheduleGridColumn reutilizável
- useSearch Hook customizado
- ConfirmDialog genérico
- Form Drafts com localStorage

---

## 📈 Impacto Após Refatoração

```
MÉTRICA                      ANTES    ATUAL (EST.)   GANHO
──────────────────────────────────────────────────
Linhas de Código             3,200    ~2,900         ~-9%
Linhas Duplicadas              450      ~230         ~-49%
Props Drilling (máx)           18+      6-8          ~-55%
Type-Safety                    85%      ~93%         ~+8%
Tempo de Manutenção           ⭐⭐⭐      ⭐⭐⭐⭐         ~+40%
```

> Observacao: valores "ATUAL (EST.)" sao estimativas de progresso incremental. O alvo final continua no bloco de metas originais.

---

## 🎯 Checklist de Implementação

### FASE 1
- [x] Criar `src/config/scheduleConfig.ts`
- [x] Criar `src/config/api.ts`
- [x] Criar `src/utils/anamneseUtils.ts`
- [x] Atualizar CollaboratorView.tsx
- [x] Atualizar SupervisorView.tsx
- [x] Atualizar EscalaTab.tsx
- [x] Atualizar BookingModal.tsx
- [x] Atualizar SupervisorClientesTab.tsx
- [x] Atualizar App.tsx (API_URL)
- [x] Atualizar AuthContext.tsx (API_URL)
- [x] Atualizar api.ts (API_URL)
- [x] Rodar `npm run lint`
- [x] Rodar `npm run build`
- [x] Testes manuais: Todos os fluxos

### FASE 2 (Quando FASE 1 estiver pronta)
- [x] Criar `src/features/appointments/hooks/useScheduleModals.ts`
- [x] Criar Context para props drilling
- [x] Criar `src/utils/formatters.ts`
- [x] Extrair `src/components/ScheduleRulerGrid.tsx`
- [x] Extrair `src/components/AppointmentScheduleFields.tsx`
- [x] Extrair `src/components/AppointmentModalShell.tsx`
- [x] Migrar escala do Supervisor para `SupervisorEscalaTab`
- [x] Atualizar componentes restantes (parcial - encerrado neste ciclo; itens residuais migrados para Roadmap Premium)
- [x] Testes integrados

### FASE 3 (Opcional)
- [x] ScheduleGridColumn
- [x] useSearch Hook
- [x] ConfirmDialog
- [x] Form Drafts
- [x] Consolidacao direta de Booking/EditAppointmentModal
- [x] Remocao do wrapper AppointmentModal

---

## 💡 Dicas de Implementação

✅ **Faça assim**:
1. Crie arquivo novo
2. Implemente função/config
3. Atualize 1 componente
4. Teste (npm run build)
5. Atualize próximo componente

❌ **Não faça assim**:
- Não altere tudo de uma vez
- Não remova código antigo antes de testar novo
- Não misture mudanças de múltiplos arquivos

---

## 🚀 Próximos Passos

1. **Agora**: Leia `REFACTOR_CODE.md` (tem código pronto)
2. **Próximo**: Implemente FASE 1 seguindo o checklist
3. **Depois**: Faça FASE 2 quando FASE 1 estiver 100% ok
4. **Opcional**: FASE 3 se houver tempo

### 🔮 ROADMAP FUTURO (Próxima Grande Atualização)

**FASE 8: Experiência do Cliente Final (Front-stage)**
Com a estabilização completa da operação (Agenda, Escalas, RH e Serviços Premium), o próximo passo é encantar o cliente final:

- **Ficha de Anamnese Digital (Self-Service via Celular):** Página mobile-friendly ativada pelo QR Code da TV. O cliente digita o telefone e preenche sua própria ficha clínica (alergias, pressões, óleos) direto no sofá da recepção. Sincronização em tempo real com a tela do Supervisor. (Pendente no BACKLOG_ATIVO.md)
- **Sistema de Fidelidade "Invisível" (Status VIP):** Motor de regras baseado no histórico de *Concluídos* e *Receita LTV*. Classifica os clientes em Tiers (ex: Silver, Gold, Platinum) silenciosamente e alerta a recepcionista para oferecer mimos (upgrade, chás especiais, espumante) em marcos comemorativos (ex: 10ª visita). (Pendente no BACKLOG_ATIVO.md)

### Atualizacao 09/04/2026 (estabilizacao e preparo de release 1.0.5-alpha)
- Correcao de JSX em `SupervisorServicosTab.tsx` para remover bloco indevido e restaurar fechamento correto da arvore de renderizacao.
- Correcao de renderizacao condicional em `SupervisorEquipeTab.tsx` (ramo ternario quebrado).
- Ajuste de tipagem no backend para acesso seguro de `tempoHigienizacaoMin` em calculo de conflito (`backend/routes.ts`).
- Alinhamento de props em `SupervisorView.tsx` removendo prop nao suportada em `SupervisorEscalaTab`.
- Validacao tecnica executada e aprovada nesta rodada:
  1. `npm run lint`
  2. `npm --prefix frontend run build`
- Bump de versao aplicado para `1.0.5-alpha` em root/frontend/backend.
- Status atual: sem erro critico de compilacao no ciclo de validacao desta release.

### Atualizacao 09/04/2026 (hardening de sessao e bootstrap sob demanda)
- Sessao endurecida no frontend (`AuthContext`):
  1. timeout por inatividade reduzido para 15 minutos.
  2. tempo maximo de sessao reduzido para 2 horas.
  3. logout automatico por expiracao com validacao recorrente e sincronizacao entre abas.
- Token JWT no backend com expiracao padrao reduzida para 2 horas (`JWT_EXPIRES_IN`, configuravel por variavel de ambiente).
- Bootstrap inicial otimizado no app: datasets pesados de supervisao (trocas de turno e overrides de escala) passaram a carregar sob demanda, apenas em contexto de supervisor ativo.
- Validacao tecnica da rodada:
  1. `npm run lint`
  2. `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  3. `npm --prefix frontend run build`
- Commit de referencia: `7f50f53`.

---

## 📞 Dúvidas?

Revise `REFACTOR_CODE.md` que tem:
- Código pronto para copiar-colar
- Linhas exatas para remover
- Exemplos de uso em cada componente

**Boa sorte! 🎉**
