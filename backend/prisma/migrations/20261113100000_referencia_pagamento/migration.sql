-- Referência da cobrança no gateway de pagamento: aleatória e separada do token da reserva do totem (que é credencial)
ALTER TABLE "Agendamento" ADD COLUMN "referenciaPagamento" TEXT;
CREATE UNIQUE INDEX "Agendamento_referenciaPagamento_key" ON "Agendamento"("referenciaPagamento");
