-- Quando o cliente autorizou, no totem, o uso dos dados pessoais e de saúde (prova do consentimento da LGPD, art. 11)
ALTER TABLE "Agendamento" ADD COLUMN "consentimentoDadosEm" TIMESTAMP(3);
