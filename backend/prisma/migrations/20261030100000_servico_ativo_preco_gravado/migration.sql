-- Serviço inativo (sai do catálogo sem apagar o histórico) e ordem no catálogo
ALTER TABLE "Servico" ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Servico" ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0;

-- Comissão opcional para a empresa
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "usarComissao" BOOLEAN NOT NULL DEFAULT true;

-- Agendamentos sem valor gravado recebem o preço atual dos serviços (melhor estimativa disponível);
-- daqui em diante o valor é gravado na criação e não muda quando o preço do serviço muda
UPDATE "Agendamento" a SET "valorTotal" = sub.total
FROM (
  SELECT r."A" AS agendamento_id, SUM(s."preco") AS total
  FROM "_AgendamentoToServico" r JOIN "Servico" s ON s."id" = r."B"
  GROUP BY r."A"
) sub
WHERE a."id" = sub.agendamento_id AND a."valorTotal" IS NULL;
