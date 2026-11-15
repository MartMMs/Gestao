# CLAUDE.md

Sistema de gestão de spa/clínica (agenda, bloqueios, equipe, escala, clientes, serviços, totem de autoatendimento, relatórios). Código, nomes e mensagens em português; responder ao usuário em pt-BR.

## Estrutura

- `backend/` — Express + Prisma (PostgreSQL) + Socket.IO + Redis opcional. Entrada `server.ts`, rotas em `routes.ts` + `routes/*Routes.ts`, regras em `services/`, utilitários em `lib/` (`transacao.ts` = `transacaoComTravas`, `http.ts` = `HttpError`, `auditoria.ts`, `cookies.ts`). Schema em `backend/prisma/schema.prisma`.
- `frontend/` — React + Vite + TanStack Query. Organizado por domínio em `src/features/<dominio>/{components,hooks,services,utils}` (ver `frontend/src/features/README.md`); telas por papel em `src/components/` (`AdminView`, `SupervisorView`, `CollaboratorView`, `TVPanelView`). Cliente HTTP em `src/api.ts`, sessão em `AuthContext.tsx`, hosts (totem/TV em subdomínio próprio) em `src/config/hosts.ts`.
- `shared/` — regras usadas pelos dois lados (agenda, escala, feriados, validadores CPF/telefone, `redact.ts` para mascarar logs). Importar via `@shared/...`; não duplicar essas regras.
- `e2e/` — Playwright. Projeto `chromium` + `configuracao-global` (`*.global.spec.ts`, roda em série depois).
- `scripts/` — `dev-all.mjs`, regressão, smoke LGPD, stress de agendamento.
- `docs/` — notas de release e guias de atualização. `freellmapi/` não faz parte do produto (não versionado).

## Comandos (na raiz)

- `npm run dev:all` — sobe backend (:3333) e frontend (:3000).
- `npm run lint` — tsc do frontend + tsc da raiz (inclui backend/shared).
- `npm test` — Vitest (testes unitários ficam ao lado do código, `*.test.ts`).
- `npm run build`
- `npm run test:e2e` — precisa de API e UI rodando; `PLAYWRIGHT_API_URL` (padrão `http://127.0.0.1:3333/api`), `PLAYWRIGHT_BASE_URL`.
- `npm run test:regression:quick` = lint + unit + build (mesmo que o job principal do CI).
- Backend: `cd backend && npm run prisma:migrate | prisma:deploy | prisma:generate | seed | seed:ci`.

## Regras importantes do domínio

- **Concorrência:** gravações de agenda, totem, escala, trocas de turno e clientes usam travas por chave dentro de transação (`transacaoComTravas`). Conflito → 409; espera longa → 503. Edições levam a versão do registro.
- **Sessão:** cookie HttpOnly; toda escrita exige header `X-Requested-With` (CSRF).
- **LGPD/privacidade:** telefone/CPF mascarados conforme papel; comissão só para supervisor; acesso ao histórico do cliente é auditado; logs passam por `shared/redact.ts`.
- **Escala:** 6x1 aceita uma folga comum por semana (seg–dom); feriados e ausências do RH não contam. `turnoPadrao` do colaborador vale nos dias de trabalho, ajuste do dia tem prioridade.
- **Tempo real:** `db_updated` informa escopos alterados (`shared/escopos.ts`); conexões sem login (totem/TV) recebem só aviso vazio.
- Fuso de Brasília para datas/horários da agenda.
- Pagamento e WhatsApp: adapters HTTP genéricos, desligados por padrão (ver README).

## Convenções

- Mudança de schema → nova migration Prisma + mencionar no README ("Antes de subir esta versão").
- Nunca colocar nome de autor em termos, rodapé ou créditos do produto.
- Falha em massa de login nos e2e locais geralmente é ambiente (banco/senha do CI), não bug.
