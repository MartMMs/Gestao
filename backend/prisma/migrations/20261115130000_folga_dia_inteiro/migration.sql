-- Folga de dia inteiro deixa de depender do horário da casa (agora configurável): o que cobria o expediente antigo
-- inteiro (09:00 às 21:00, ou mais) passa a ser 00:00 às 23:59. Bloqueio parcial não muda.
UPDATE "Bloqueio" SET "horaInicio" = '00:00', "horaFim" = '23:59' WHERE "horaInicio" <= '09:00' AND "horaFim" >= '21:00';
