-- Versão das credenciais: trocar senha/e-mail ou reativar a conta invalida todos os tokens já emitidos
ALTER TABLE "Colaborador" ADD COLUMN "versaoToken" INTEGER NOT NULL DEFAULT 0;
