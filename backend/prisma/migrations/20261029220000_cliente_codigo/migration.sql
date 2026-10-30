-- Código de identificação do cliente (numeração sequencial; os existentes recebem número na ordem atual)
ALTER TABLE "Cliente" ADD COLUMN "codigo" SERIAL NOT NULL;
CREATE UNIQUE INDEX "Cliente_codigo_key" ON "Cliente"("codigo");
