# Release Notes

## Versao 1.1.0-beta.1
- Tag: v1.1.0-beta.1
- Tipo: pre-release (beta)
- Base de comparacao: master (b325416)
- Escopo: totem em subdominio proprio, desempenho da agenda, historico do cliente com auditoria e correcoes
  apontadas por uma banca de revisao (seguranca, usabilidade, codigo e testes).

### Novidades
1. **Totem de autoatendimento em subdominio proprio.** Em `autoatendimento.<dominio>` (ou nos hosts de
   `VITE_AUTOATENDIMENTO_HOST`) o app carrega so o totem: sem login, sem o codigo do portal e sem acesso a
   sessao da equipe. O botao "Recomecar" e o fechamento da pagina liberam a reserva em aberto.
2. **Historico completo do cliente.** `GET /agendamentos?clienteId=<uuid>` traz o periodo todo (inclusive
   faltas), ate os 300 atendimentos mais recentes, com aviso na tela quando o teto e atingido.
3. **Trilha de auditoria.** Cada abertura do historico grava quem abriu, qual cliente, IP e quantos registros
   vieram (tabela `AcessoHistoricoCliente`, migracao `20261029160000_acesso_historico_cliente`). Sem o registro,
   o historico nao e entregue.
4. **Cargo separado da funcao de acesso** no cadastro de profissionais.

### Desempenho
1. Agenda: agendamentos agrupados por profissional com referencia estavel; so a coluna afetada redesenha.
   Fora do dia de hoje, o relogio nao redesenha a grade.
2. `GET /agendamentos` devolve so o ultimo ano e ja descarta cancelados/nao comparecimentos no servidor.
3. Aviso `db_updated` com escopo (`shared/escopos.ts`): cada tela recarrega so as listas que mudaram.
4. Painel da TV: relogio isolado (o tique de 1 s nao redesenha o painel inteiro).

### Seguranca
1. Conexoes sem login recebem apenas um aviso vazio, e so quando mudam agendamentos ou servicos.
2. `?desde=` aceita so datas reais e nunca alem de um ano; `?clienteId=` exige UUID (400 caso contrario).
3. Cargo (60) e especialidade (100) com tamanho limitado no servidor.

### Correcoes
1. `VITE_API_URL`/`VITE_SOCKET_URL` eram ignoradas no build de producao.
2. A linha vermelha da agenda nao cobria todas as colunas quando havia rolagem horizontal.
3. Painel da TV virava o dia as 21h (usava UTC).
4. Toasts: uma mensagem nova era apagada pelo timer da anterior.
5. Agendamento sem lista de servicos quebrava a grade.

### Implantacao
1. Rode `npm --prefix backend run prisma:deploy` (nova tabela de auditoria).
2. Para o totem: DNS do subdominio, origem em `CORS_ORIGINS` e `VITE_AUTOATENDIMENTO_URL` no build.

### Validacao
- 63 testes unitarios, typecheck do frontend/backend/shared e build.
- 14/14 testes E2E (Playwright + Postgres 16).
