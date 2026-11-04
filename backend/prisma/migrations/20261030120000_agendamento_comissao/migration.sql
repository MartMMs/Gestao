-- Comissão gravada no atendimento; os antigos recebem a calculada com o percentual atual dos serviços
ALTER TABLE "Agendamento" ADD COLUMN "valorComissao" DOUBLE PRECISION;

UPDATE "Agendamento" a SET "valorComissao" = sub.comissao
FROM (
  SELECT r."A" AS agendamento_id, ROUND(SUM(s."preco" * COALESCE(s."comissaoPercentual", 0) / 100)::numeric, 2)::double precision AS comissao
  FROM "_AgendamentoToServico" r JOIN "Servico" s ON s."id" = r."B"
  GROUP BY r."A"
) sub
WHERE a."id" = sub.agendamento_id;
