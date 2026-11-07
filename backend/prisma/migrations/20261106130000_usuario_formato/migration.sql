-- O login compara o usuário exato (sem ignorar caixa): o banco garante o formato que a API grava (shared/validadores
-- USUARIO_REGEX), para um insert por fora (script, SQL manual) não criar uma conta que nunca consegue entrar
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_usuario_formato" CHECK ("usuario" IS NULL OR "usuario" ~ '^[a-z0-9._-]{3,40}$');
