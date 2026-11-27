-- Formulário de anamnese configurável e fichas preenchidas (cópia imutável). Só acrescenta: a ficha antiga
-- (Cliente.observacao e Agendamento.observacoesSaude) continua igual. Rollback: DROP das duas tabelas e da coluna.
ALTER TABLE "ConfiguracaoEmpresa" ADD COLUMN "formularioVersao" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CampoFormulario" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "ajuda" TEXT,
    "tipo" TEXT NOT NULL,
    "opcoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "canal" TEXT NOT NULL DEFAULT 'ambos',
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "dadoSensivel" BOOLEAN NOT NULL DEFAULT true,
    "respostasAlerta" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampoFormulario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampoFormulario_chave_key" ON "CampoFormulario"("chave");

CREATE TABLE "FichaPreenchida" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "agendamentoId" TEXT,
    "canal" TEXT NOT NULL,
    "vinculadaAoCliente" BOOLEAN NOT NULL DEFAULT true,
    "versaoFormulario" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "alertas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preenchidoPorId" TEXT,
    "preenchidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FichaPreenchida_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FichaPreenchida_clienteId_preenchidoEm_idx" ON "FichaPreenchida"("clienteId", "preenchidoEm");
CREATE INDEX "FichaPreenchida_agendamentoId_idx" ON "FichaPreenchida"("agendamentoId");
ALTER TABLE "FichaPreenchida" ADD CONSTRAINT "FichaPreenchida_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
