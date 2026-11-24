-- Habilidades cadastradas (N:N com colaboradores e serviços) e exigência global; copia as listas de texto antigas
-- AlterTable
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN     "exigenciaHabilidades" TEXT NOT NULL DEFAULT 'sempre';

-- CreateTable
CREATE TABLE "Habilidade" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nomeNormalizado" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Habilidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ColaboradorHabilidades" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ColaboradorHabilidades_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ServicoHabilidades" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ServicoHabilidades_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Habilidade_nomeNormalizado_key" ON "Habilidade"("nomeNormalizado");

-- CreateIndex
CREATE INDEX "_ColaboradorHabilidades_B_index" ON "_ColaboradorHabilidades"("B");

-- CreateIndex
CREATE INDEX "_ServicoHabilidades_B_index" ON "_ServicoHabilidades"("B");

-- AddForeignKey
ALTER TABLE "_ColaboradorHabilidades" ADD CONSTRAINT "_ColaboradorHabilidades_A_fkey" FOREIGN KEY ("A") REFERENCES "Colaborador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ColaboradorHabilidades" ADD CONSTRAINT "_ColaboradorHabilidades_B_fkey" FOREIGN KEY ("B") REFERENCES "Habilidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServicoHabilidades" ADD CONSTRAINT "_ServicoHabilidades_A_fkey" FOREIGN KEY ("A") REFERENCES "Habilidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ServicoHabilidades" ADD CONSTRAINT "_ServicoHabilidades_B_fkey" FOREIGN KEY ("B") REFERENCES "Servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dados: cada nome usado nas listas antigas vira uma habilidade (sem diferenciar maiúsculas nem espaços sobrando).
-- As colunas antigas ficam intactas (versão anterior do sistema continua lendo-as se precisar voltar)
WITH nomes AS (
  SELECT btrim(regexp_replace(h, '\s+', ' ', 'g')) AS nome FROM "Colaborador", unnest("habilidades") AS h
  UNION ALL
  SELECT btrim(regexp_replace(h, '\s+', ' ', 'g')) FROM "Servico", unnest("habilidadesPermitidas") AS h
)
INSERT INTO "Habilidade" ("id", "nome", "nomeNormalizado", "atualizadoEm")
SELECT gen_random_uuid()::text, min(nome), lower(nome), CURRENT_TIMESTAMP
FROM nomes WHERE nome <> '' GROUP BY lower(nome);

INSERT INTO "_ColaboradorHabilidades" ("A", "B")
SELECT DISTINCT c."id", hab."id"
FROM "Colaborador" c, unnest(c."habilidades") AS h
JOIN "Habilidade" hab ON hab."nomeNormalizado" = lower(btrim(regexp_replace(h, '\s+', ' ', 'g')));

INSERT INTO "_ServicoHabilidades" ("A", "B")
SELECT DISTINCT hab."id", s."id"
FROM "Servico" s, unnest(s."habilidadesPermitidas") AS h
JOIN "Habilidade" hab ON hab."nomeNormalizado" = lower(btrim(regexp_replace(h, '\s+', ' ', 'g')));
