-- Uma reserva do totem vira no máximo um agendamento, mesmo que o resultado guardado no Redis se perca
ALTER TABLE "Agendamento" ADD COLUMN "reservaToken" TEXT;
CREATE UNIQUE INDEX "Agendamento_reservaToken_key" ON "Agendamento"("reservaToken");
