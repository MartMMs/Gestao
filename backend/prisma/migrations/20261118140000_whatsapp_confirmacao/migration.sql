-- Opt-out de lembretes, pergunta de confirmação no lembrete e aviso de ausência vindo do WhatsApp
ALTER TABLE "Cliente" ADD COLUMN "naoReceberWhatsapp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "lembretePedeConfirmacao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agendamento" ADD COLUMN "clienteAvisouAusenciaEm" TIMESTAMP(3);
