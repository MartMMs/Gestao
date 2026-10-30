-- Comissão gravada no atendimento. Nos antigos, proporcional ao valor gravado (o da época) com o percentual
-- atual dos serviços (mesma regra da edição em shared/valores.ts); sem valor gravado ou sem preço, o percentual puro.
ALTER TABLE "Agendamento" ADD COLUMN "valorComissao" DOUBLE PRECISION;

UPDATE "Agendamento" a SET "valorComissao" = CASE
    WHEN a."valorTotal" IS NOT NULL AND sub.preco_hoje > 0
      THEN ROUND((a."valorTotal" * sub.comissao_hoje / sub.preco_hoje)::numeric, 2)::double precision
    ELSE ROUND(sub.comissao_hoje::numeric, 2)::double precision
  END
FROM (
  SELECT r."A" AS agendamento_id,
         SUM(s."preco") AS preco_hoje,
         SUM(s."preco" * COALESCE(s."comissaoPercentual", 0) / 100) AS comissao_hoje
  FROM "_AgendamentoToServico" r JOIN "Servico" s ON s."id" = r."B"
  GROUP BY r."A"
) sub
WHERE a."id" = sub.agendamento_id;
