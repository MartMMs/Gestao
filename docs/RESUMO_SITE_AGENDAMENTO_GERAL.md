# Resumo Executivo - Site de Agendamento Geral

Atualizado em: 09/04/2026

## Visão do Produto

Você está construindo uma plataforma de agendamento e operação de equipe para ambiente de serviços (spa/clínica), com foco em:
- agendamento de clientes,
- gestão de colaboradores,
- planejamento de escalas,
- conformidade CLT,
- visão operacional para supervisão,
- experiência de recepção e painel TV.

## O que o sistema já tem hoje

### Núcleo de operação
- Autenticação com sessão endurecida (timeout por inatividade, tempo máximo de sessão, controle de expiração).
- Perfis de acesso por função (supervisor, colaborador, painel TV).
- CRUD de agendamentos com validações de conflito e regras operacionais.
- CRUD de serviços com modelo premium (categoria, higienização, comissão).
- Gestão de clientes com histórico e dados clínicos.

### Escalas e planejamento
- Geração e edição de escala por colaborador.
- Edição em lote de turnos (bulk edit) para equipe.
- Overrides de escala e operações de ajuste pelo supervisor.
- Fluxo de solicitação e aprovação/rejeição de troca de turno.
- Dashboard de escala e visão timeline/calendário.

### Compliance e monitoramento
- Motor CLT ativo no frontend com:
  - validação de interjornada,
  - validação de sequência de 7 dias (DSR),
  - integração ao sino global (alerta visual + contador + auditoria).

### Entrega e governança
- Processo de versão/release documentado.
- Tag de release recente publicada (v1.0.5-alpha.1).
- Backlog consolidado em arquivo único para execução.

## O que você precisa para fechar a próxima fase

### Regras operacionais críticas
- Fechar regra oficial de exibição para colaboradores em folga no agendamento.
- Definir e aplicar bloqueio automático/manual de agendamento para colaborador em folga.
- Integrar feriados automaticamente na malha de escala (regra viva no calendário, não só utilitário).

### Produto e previsibilidade
- Expandir filtros de visualização de escala (semanal, mensal, por colaborador, turno e carga).
- Implementar férias automáticas no calendário de escalas.
- Entregar relatórios de sobrecarga e gargalos com exportação PDF/CSV.

### Organização e comunicação
- Padronizar documentação legada para o modelo atual frontend/backend.
- Usar BACKLOG_ATIVO.md como única fonte de pendências para sprint.

## O que falta (resumo do backlog ativo)

### Sprint 01 (P0)
- BLG-001, BLG-002, BLG-003.
- Foco: estabilização operacional imediata.

### Sprint 02 (P1)
- BLG-004, BLG-005, BLG-006, BLG-007.
- Foco: ganho de produtividade da supervisão e governança.

### Roadmap (P2)
- BLG-008 a BLG-013 (Google Calendar, notificações, mobile, auditoria avançada, anamnese digital, fidelidade).

## Mensagem curta para apresentar seu projeto

Estou desenvolvendo um site de agendamento geral com gestão completa de operação: agendamento de clientes, serviços, equipe, escalas e conformidade CLT em tempo real. O sistema já está funcional nos fluxos principais e agora estamos fechando as regras operacionais finais (folga/feriados), evoluindo relatórios e preparando a próxima sprint de escala e produtividade.
