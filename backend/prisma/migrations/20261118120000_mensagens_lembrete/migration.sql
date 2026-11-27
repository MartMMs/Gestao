-- Mensagens de lembrete do WhatsApp escritas pela casa
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "mensagensLembrete" TEXT[] DEFAULT ARRAY[]::TEXT[];
