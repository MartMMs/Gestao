# Backlog Ativo Consolidado

Atualizado em: 09/04/2026
Objetivo: manter uma fonte única de pendências abertas, em formato pronto para sprint.

## Convenções

- Prioridade: P0 (sprint atual), P1 (próxima sprint), P2 (evolutivo).
- Responsável: papel dono da execução (podendo ter co-responsável).
- Status: itens com `[ ]` estão ativos; itens com `[x]` foram concluídos e mantidos como evidência.

## Planejamento de Sprint (Execução)

### Sprint 01 - Operacional (P0)

Período sugerido: 10/04/2026 a 16/04/2026

| Item | Objetivo | Responsável | Estimativa |
|------|----------|-------------|------------|
| BLG-001 | Regra final de exibição no agendamento para folga (concluído em 12/11/2026) | Produto/Supervisão + Frontend | 3h |
| BLG-002 | Bloqueio automático/manual para colaborador em folga | Backend + Frontend | 8h |
| BLG-003 | Feriados automáticos integrados na malha (concluído em 09/04/2026) | Backend + Frontend | 6h |

Total estimado Sprint 01: 17h

### Sprint 02 - Produto (P1)

Período sugerido: 17/04/2026 a 24/04/2026

| Item | Objetivo | Responsável | Estimativa |
|------|----------|-------------|------------|
| BLG-004 | Filtros avançados da escala (concluído em 09/04/2026) | Frontend | 10h |
| BLG-005 | Férias automáticas | Backend + Frontend | 6h |
| BLG-006 | Relatórios e exportação (PDF/CSV) | Frontend + Backend | 14h |
| BLG-007 | Padronização documental frontend/backend | Documentação | 4h |

Total estimado Sprint 02: 34h

### Reserva Evolutiva (P2)

Esforço agregado estimado para roadmap P2 (BLG-008 a BLG-013): 70h a 110h.

## P0 - Sprint Atual (Operacional)

- [x] BLG-001 - Definir regra final de exibição no agendamento para colaboradores de folga.
  - Regra aplicada: o filtro "Somente de folga" (agenda, visão Dia) mostra quem está de folga, FDS ou férias (escala ou ajuste do dia) ou com bloqueio do dia inteiro; bloqueio parcial fica de fora (`frontend/src/features/scale/utils/statusDoDia.ts`, com teste).
  - Responsável: Produto/Supervisão
  - Co-responsável: Frontend
  - Critério de aceite: regra documentada e aplicada na tela de agendamento sem divergência de comportamento.
  - Fonte: RESUMO_CONSOLIDADO.md

- [ ] BLG-002 - Definir e aplicar bloqueio automático/manual para colaboradores em folga na data.
  - Responsável: Backend
  - Co-responsável: Frontend
  - Critério de aceite: criação de agendamento para colaborador em folga bloqueada conforme regra definida; fluxo manual disponível para supervisor quando aplicável.
  - Fonte: RESUMO_CONSOLIDADO.md

- [x] BLG-003 - Integrar feriados automaticamente na malha de escalas (além do utilitário isolado).
  - Responsável: Backend
  - Co-responsável: Frontend
  - Critério de aceite: dias feriados impactam a malha automaticamente e aparecem de forma consistente na UI.
  - Evidências: integração no pipeline da malha (`escalaCalculator`), atualização de calendário/timeline/dashboard e endpoint backend `/feriados`.
  - Fontes: RESUMO_CONSOLIDADO.md, ESCALA_FEATURES.md

## P1 - Próxima Sprint (Produto)

- [x] BLG-004 - Expandir filtros de visualização da escala (semanal, mensal, por colaborador, por turno, por carga horária).
  - Responsável: Frontend
  - Co-responsável: Produto/Supervisão
  - Critério de aceite: filtros disponíveis na UI e combináveis sem regressão no desempenho da timeline/calendário.
  - Evidências: recorte semanal/mensal com range por semana de calendário, filtro por colaborador, turno e faixa de carga semanal em Planejamento.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-005 - Implementar férias automáticas em período permitido.
  - Responsável: Backend
  - Co-responsável: Frontend
  - Critério de aceite: regras de férias aplicadas automaticamente e refletidas na escala sem ajuste manual obrigatório.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-006 - Criar relatórios de sobrecarga/gargalos e exportação PDF/CSV.
  - Responsável: Frontend
  - Co-responsável: Backend
  - Critério de aceite: relatórios gerados com filtros mínimos e exportação funcional para PDF e CSV.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-007 - Padronizar documentação legada para estrutura atual frontend/backend.
  - Responsável: Documentação
  - Co-responsável: Produto/Supervisão
  - Critério de aceite: documentos principais atualizados sem referências obsoletas de estrutura.
  - Fonte: RESUMO_CONSOLIDADO.md

## P2 - Evolutivo (Roadmap)

- [ ] BLG-008 - Integração com calendário externo (Google Calendar).
  - Responsável: Backend
  - Co-responsável: Frontend
  - Critério de aceite: sincronização básica de eventos de escala com calendário externo.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-009 - Notificações por e-mail.
  - Responsável: Backend
  - Co-responsável: DevOps
  - Critério de aceite: envio automático de notificações de eventos críticos da escala.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-010 - App mobile para visualização de escala.
  - Responsável: Frontend
  - Co-responsável: Produto/Supervisão
  - Critério de aceite: versão mobile com visualização de escala e autenticação funcional.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-011 - Histórico e trilha de auditoria de mudanças de escala.
  - Responsável: Backend
  - Co-responsável: Frontend
  - Critério de aceite: registro de alterações com usuário, data/hora e antes/depois acessível na UI.
  - Fonte: ESCALA_FEATURES.md

- [ ] BLG-012 - Ficha de anamnese digital self-service via QR/TV.
  - Responsável: Frontend
  - Co-responsável: Backend
  - Critério de aceite: fluxo completo de preenchimento e sincronização em tempo real com supervisão.
  - Fonte: REFACTOR.md

- [ ] BLG-013 - Sistema de fidelidade invisível (tiers e gatilhos de atendimento).
  - Responsável: Produto/Supervisão
  - Co-responsável: Backend
  - Critério de aceite: regras de tier calculadas pelo histórico e sinalização operacional na recepção.
  - Fonte: REFACTOR.md

- [ ] BLG-014 - Conectar um provedor real de pagamento do totem (sob demanda).
  - Responsável: Backend
  - Critério de aceite: provedor escolhido atende o contrato do adapter HTTP (`backend/services/gatewayPagamento.ts`): `POST {referencia, valor, descricao}` -> `{pixCopiaECola, pixQrCode?, cartaoOnlineDisponivel?}` e webhook assinado devolvendo a `referencia` (id aleatório gravado em `referenciaPagamento`, nunca o token da reserva). Pendente: cancelar a cobrança órfã quando o provedor oferecer. Pré-pronto e desligado por padrão (`PAYMENT_GATEWAY_URL` vazio = pagamento na recepção).

- [ ] BLG-015 - Conectar um provedor real de WhatsApp (sob demanda).
  - Responsável: Backend
  - Co-responsável: Produto/Supervisão (consentimento LGPD/opt-out)
  - Critério de aceite: provedor recebe `POST {telefone, mensagem}` (`backend/services/whatsapp.ts`); confirmação do totem e lembrete 24h entregues. Pré-pronto e desligado por padrão (`WHATSAPP_WEBHOOK_URL` vazio = só log com telefone mascarado). Definir formato do telefone (+55) e opt-out antes de ligar.

## Itens Encerrados Nesta Consolidação

- Revisão dos checklists antigos com status desatualizado.
- Migração Prisma do módulo de escalas no ambiente alvo marcada como concluída em INTEGRACAO_ESCALAS.md.
- Pendências removidas dos documentos históricos e centralizadas neste arquivo.
- BLG-003 concluído com validação de testes/lint/build em 09/04/2026.
- BLG-004 concluído com validação de lint/build em 09/04/2026.
- BLG-001 concluído em 12/11/2026 (regra do filtro "Somente de folga" com teste).
- Trilha de acessos ao histórico de clientes (LGPD) consultável em Relatórios, para supervisão e administração, em 12/11/2026 (`GET /auditoria/acessos-historico`).
- Código de reserva AG-XXXXXX para todos os agendamentos e busca com Enter na Agenda da Recepção (13/11/2026).
- Lista "Sem baixa" na Agenda da Recepção (13/11/2026).
- Regra de folgas por escala no servidor (6x1: uma folga comum por semana; 5x2: dias livres) e horário de trabalho (`turnoPadrao`) no cadastro (13/11/2026).
- 13ª rodada da banca: APROVADO PRA SUBIR 4/4 (13/11/2026).
