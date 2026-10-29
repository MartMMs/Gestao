-- Trilha de auditoria dos acessos ao histórico de clientes (dados de saúde)
CREATE TABLE "AcessoHistoricoCliente" (
    "id" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "ip" TEXT,
    "registros" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcessoHistoricoCliente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AcessoHistoricoCliente_clienteId_criadoEm_idx" ON "AcessoHistoricoCliente"("clienteId", "criadoEm");
CREATE INDEX "AcessoHistoricoCliente_colaboradorId_criadoEm_idx" ON "AcessoHistoricoCliente"("colaboradorId", "criadoEm");
