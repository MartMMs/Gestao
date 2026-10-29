-- Versão do agendamento para detectar edição simultânea (409 em vez de sobrescrever a alteração de outra pessoa)
ALTER TABLE "Agendamento" ADD COLUMN "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
