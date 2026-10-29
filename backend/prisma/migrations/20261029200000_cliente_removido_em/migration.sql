-- Cliente excluído com histórico: dados pessoais apagados, atendimentos mantidos
ALTER TABLE "Cliente" ADD COLUMN "removidoEm" TIMESTAMP(3);
