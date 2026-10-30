CREATE TABLE "RegistroAuditoria" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "acao" TEXT NOT NULL,
    "alvo" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistroAuditoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RegistroAuditoria_criadoEm_idx" ON "RegistroAuditoria"("criadoEm");
