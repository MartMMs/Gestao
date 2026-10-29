# Backend - Gestao

Backend responsavel por autenticacao, regras de negocio, persistencia em PostgreSQL e notificacao em tempo real para o frontend.

## Stack em uso

- Node.js com TypeScript (execucao via tsx)
- Express 4
- Prisma Client + Prisma Migrate
- PostgreSQL
- JWT (autenticacao)
- bcryptjs (hash de senha)
- Socket.IO (evento de sincronizacao db_updated)

## Estrutura atual

```text
backend/
	server.ts                 # Bootstrap: HTTP + Socket.IO, CORS, erros globais, limpeza agendada
	env.ts                    # Carrega o .env da raiz antes dos demais modulos
	db.ts                     # Cliente Prisma unico (nunca devolve o hash da senha)
	auth.ts                   # JWT (HS256) e middlewares de permissao
	routes.ts                 # Monta a API juntando os modulos abaixo
	routes/
		empresaRoutes.ts        # Login, feriados e configuracoes da empresa
		colaboradoresRoutes.ts  # Equipe (papeis, senhas)
		agendamentosRoutes.ts   # Agenda interna
		clientesRoutes.ts       # Clientes e anamnese
		servicosRoutes.ts       # Servicos e bloqueios
		escalaRoutes.ts         # Escala e trocas de turno
		autoatendimentoRoutes.ts# Totem publico (reserva, confirmacao, webhook)
	services/
		agendaService.ts        # Conflitos, interjornada CLT, escala e elegibilidade (fonte unica)
		configService.ts        # Configuracoes padrao da empresa e do totem
		redisService.ts         # Travas e rate limit (fallback em memoria)
		communicationService.ts # Voucher e mensagens
	lib/                      # Erros HTTP, transacoes e regras de LGPD
	criar-usuario.ts          # Cria usuarios com senha (CLI)
	prisma/                   # Schema, migracoes e seed de CI
	seed.ts                   # Dados de demonstracao (apaga o banco; bloqueado em producao)
```

## Comportamento tecnico principal

- A API e montada em /api via createRouter(io).
- Login gera token JWT e libera acesso autenticado.
- Middleware verifica token e permissao de supervisor em rotas administrativas.
- Operacoes criticas notificam o frontend via evento db_updated.
- Existe redacao de dados sensiveis (CPF, telefone, e-mail, senha, token) em logs.
- Usuarios que nao sao supervisores recebem CPF/telefone mascarados; a anamnese so aparece para o profissional do atendimento.
- Tarefa periodica (5 min): cancela reservas do totem sem pagamento no prazo e marca agendamentos antigos nao concluidos como no_show (LIMPEZA_AGENDAMENTOS_DIAS).

## Persistencia de dados (Prisma)

Modelos principais no schema atual:

- Colaborador
- Cliente
- Servico
- Agendamento
- Bloqueio
- SolicitacaoTroca
- EscalaOverride

Escala e trocas de turno ficam somente no PostgreSQL (EscalaOverride e SolicitacaoTroca).
O antigo arquivo `escala_overrides.json` nao e mais lido.

## Grupos de endpoints

Base URL: /api

Autenticacao e empresa:

- POST /login (publico; 10 senhas erradas por e-mail bloqueiam por 15 min)
- GET /feriados
- GET /empresa/config (publico) e PUT /empresa/config (supervisor)

Colaboradores:

- GET /colaboradores
- POST /colaboradores
- PUT /colaboradores/:id
- DELETE /colaboradores/:id

Agendamentos:

- GET /agendamentos
- POST /agendamentos
- PUT /agendamentos/:id
- DELETE /agendamentos/:id
- PATCH /agendamentos/:id/status
- PATCH /agendamentos/:id/concluir
- PATCH /agendamentos/:id/colaborador
- PATCH /agendamentos/:id/reassign
- PATCH /agendamentos/:id/servicos/remover
- GET /agendamentos/relatorio/concluidos

Servicos:

- GET /servicos
- POST /servicos
- PUT /servicos/:id
- DELETE /servicos/:id

Clientes:

- GET /clientes
- PUT /clientes/:id
- DELETE /clientes/:id

Bloqueios:

- GET /bloqueios
- POST /bloqueios
- DELETE /bloqueios/:id

Escala e planejamento:

- GET /escala/overrides
- POST /escala/override
- POST /escala/swap
- POST /escala/replicate

Trocas de turno:

- GET /trocas-turno (colaborador ve so as proprias)
- POST /trocas-turno (sempre nasce pendente, em nome de quem pede)
- PATCH /trocas-turno/:id/status (supervisor; recusa aprovar se houver atendimentos no dia)

Autoatendimento (/api/autoatendimento, publico com limite de requisicoes):

- GET /empresa, GET /config, PUT /config (supervisor)
- GET /servicos, GET /salas, GET /disponibilidade
- POST /reservar-slot (ate 60 dias a frente; limite de reservas por IP)
- GET /sessao/:sessionToken
- POST /confirmar-pagamento (idempotente; nunca marca como pago)
- POST /cancelar-reserva
- POST /webhook-pagamento (assinatura HMAC de `timestamp.corpo` + `x-webhook-timestamp` obrigatorios)
- GET /voucher/:agendamentoId (recepcao/supervisao)

## Scripts (pasta backend)

- npm run dev
- npm run criar-usuario -- --email x@y.com --nome "Nome" --papel admin [--gerar-senha] [--sobrescrever]
- npm run seed (dados de demonstracao; exige SEED_PASSWORD para os profissionais; admin e supervisor recebem senhas aleatorias mostradas no fim)
- npm run seed:ci (usuarios de teste; exige E2E_PASSWORD)
- npm run prisma:generate
- npm run prisma:migrate
- npm run prisma:deploy

Scripts uteis na raiz para operacao integrada:

- npm run dev:all
- npm run smoke:lgpd
- npm run test:e2e

## Variaveis de ambiente

Veja `.env.example` na raiz. O servidor carrega o `.env` da raiz e nao sobe sem `JWT_SECRET`
(minimo 32 caracteres).

## O que ainda falta melhorar

Prioridade alta:

- Adicionar validacao de payload declarativa (ex.: Zod) para padronizar as validacoes manuais.
- Integrar gateway de pagamento real ao webhook assinado.

Prioridade media:

- Padronizar resposta de erro (code, message, requestId) em toda API.
- Adicionar testes automatizados de backend (unitario e integracao) para regras criticas.
- Evoluir politica de seguranca HTTP (helmet, rate limit e CORS restrito por ambiente).

Prioridade baixa:

- Substituir cleanup por scheduler dedicado com telemetria.
- Melhorar observabilidade com logs estruturados e correlacao por request.