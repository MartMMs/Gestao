-- Chave da empresa: exigir ficha de anamnese ao agendar e ao cadastrar cliente
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "exigirAnamnese" BOOLEAN NOT NULL DEFAULT false;
