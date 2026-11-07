-- Usuário de acesso (login sem e-mail) e e-mail opcional de verdade: vazio vira NULL (o índice único aceita vários NULL)
ALTER TABLE "Colaborador" ADD COLUMN "usuario" TEXT;
CREATE UNIQUE INDEX "Colaborador_usuario_key" ON "Colaborador"("usuario");
UPDATE "Colaborador" SET "email" = NULL WHERE "email" = '';
