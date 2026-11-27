-- Dias especiais do horário de funcionamento: datas fechadas ou com horário próprio (lista vazia = só o horário da semana)
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "diasEspeciais" JSONB NOT NULL DEFAULT '[]';
