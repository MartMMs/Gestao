-- Horário padrão dos dias de trabalho ("HH:MM-HH:MM"). Nulo = como antes (sem turno: vale o horário da casa)
ALTER TABLE "Colaborador" ADD COLUMN "turnoPadrao" TEXT;
