-- Corrige o preenchimento de 20261030120000: lá a comissão dos atendimentos antigos foi calculada com o preço
-- de hoje, mas o valor gravado (valorTotal) é o da época. Aqui ela passa a ser proporcional ao valor gravado,
-- com o percentual atual dos serviços (mesma regra de shared/valores.ts: comissaoProporcional).
-- Só corrige quem ainda tem exatamente o valor daquele preenchimento (não reescreve comissão gravada depois,
-- na criação ou na edição), e é idempotente: rodar de novo não muda nada.
UPDATE "Agendamento" a SET "valorComissao" = ROUND((a."valorTotal" * sub.comissao_hoje / sub.preco_hoje)::numeric, 2)::double precision
FROM (
  SELECT r."A" AS agendamento_id,
         SUM(s."preco") AS preco_hoje,
         SUM(s."preco" * COALESCE(s."comissaoPercentual", 0) / 100) AS comissao_hoje
  FROM "_AgendamentoToServico" r JOIN "Servico" s ON s."id" = r."B"
  GROUP BY r."A"
) sub
WHERE a."id" = sub.agendamento_id
  AND a."valorTotal" IS NOT NULL
  AND sub.preco_hoje > 0
  AND a."valorComissao" = ROUND(sub.comissao_hoje::numeric, 2)::double precision;
