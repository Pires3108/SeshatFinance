# US-003 — Verificação do bootstrap local em 06/10/2026

Referência: SESHAT-19, US-003, Sprint 0.

O comando `pnpm db:bootstrap` aguarda o health check do PostgreSQL 17, gera o cliente Prisma com a configuração explícita do projeto, aplica as migrations publicadas e executa o seed sintético idempotente. `POSTGRES_PORT` configura a porta do host; a porta interna permanece 5432. A URL de desenvolvimento deve usar a mesma porta e o banco sintético local.

## Evidência local

- Docker Desktop recuperado e engine 28.3.3 confirmado por `docker info`.
- Bootstrap executado com banco saudável na porta 55439: 15 migrations aplicadas e seed concluído.
- Quatro testes unitários passaram: readiness falha antes de migrar, migration falha antes do seed, portas inválidas e URL externa ou incompatível rejeitadas antes de iniciar processos.
- `pnpm test:bootstrap` passou com PostgreSQL real: porta padrão ocupada, porta alternativa escolhida, porta interna 5432, seed presente uma vez, parada sem remoção do volume e novo bootstrap preservando o mesmo registro sintético.
- Formatação dos arquivos alterados, `pnpm lint:bootstrap`, `pnpm typecheck:bootstrap` e `git diff --check` passaram. A geração do cliente pelo script `db:generate` com configuração explícita também passou.

O teste de bootstrap usa um projeto Compose temporário e remove apenas seu volume sintético ao terminar. O comando de desenvolvimento mantém o volume. Nenhum cálculo financeiro, saldo ou transação externa foi alterado.

## Pendência da base

A formatação geral da base publicada apontou três arquivos de webhook fora do padrão: `.cursor/hooks/require-webhook-waiter.test.mjs`, `tools/agent-waiter/src/infrastructure.ts` e `tools/agent-waiter/test/webhook-observer.test.mjs`. Esta evidência não declara esses arquivos verificados nem os gates gerais de todos os módulos concluídos; a auditoria da fundação deve resolver essa pendência separadamente.
