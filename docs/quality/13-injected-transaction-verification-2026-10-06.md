# US-012 — Dependências determinísticas e transação real

## Rastreabilidade

US-012 / [SESHAT-28](https://nicolaspires.atlassian.net/browse/SESHAT-28), RNF-048/RNF-049, ET-003/ET-010 e INV-007/INV-008/INV-046. Decisão: [ADR-030](../decisions/0030-contexto-transacional-injetavel.md).

## Critérios BDD e implementação

- Relógio fixo: `Clock` retorna instante UTC. `readCivilDate` deriva data ISO com fuso IANA explícito, sem consultar relógio global. Três testes verificam comparação determinística com vencimento civil, virada exata de meia-noite em São Paulo/Tóquio e rejeição de entradas inválidas. Não define regras de vencimento de cartões ou feriados.
- IDs controlados: a fixture existente `SequenceIdentifierGenerator` retorna dois IDs na ordem configurada e rejeita sequência esgotada; `FixedClock` retorna cópias independentes do instante. Seus dois testes passaram.
- Falha transacional: `PrismaTransactionRunner` implementa a porta de Application sem expor ORM nessa porta. `PrismaTransferRepository` utiliza o runner para inserção e atualização dos dois lados com auditoria. O teste PostgreSQL força falha após as gravações dos lados e verifica que nenhuma escrita parcial foi mantida.
- Concorrência: o contexto de duas operações simultâneas permanece distinto; testes de transferência verificam idempotência concorrente e controle otimista. Escopos aninhados são rejeitados explicitamente.

## Verificação executada

- Docker Desktop: engine 28.3.3 disponível antes da integração.
- `pnpm --filter @seshat/database db:generate`: passou com configuração Prisma explícita publicada em US-003.
- Application: tipos e lint passaram; 64 testes em 22 arquivos passaram.
- Database: tipos e lint passaram; quatro testes unitários passaram.
- Test-support: dois testes passaram.
- Prettier de todo o repositório passou após incorporar o reparo de três arquivos publicado em US-004 (0518727, aplicado como 13148bc); `git diff --check` passou.
- `vitest run --config vitest.integration.config.ts src/transfers/prisma-transfer-repository.integration.spec.ts`: cinco testes passaram com PostgreSQL 17 real, incluindo rollback, auditoria, idempotência e concorrência.
- Busca em fontes de produção Domain/Application não encontrou chamadas a `Date.now`, `randomUUID`, `Math.random` ou `new Date()` sem argumento.

Os comandos pnpm usaram `--config.verify-deps-before-run=false` para reutilizar dependências locais já instaladas por junctions ignoradas, preservando o lockfile e sem alterar os links compartilhados. As fontes alteradas foram verificadas neste worktree; a integração usa seu cliente Prisma gerado localmente. A instalação imutável de CI é verificada no incremento US-004.

## Limites operacionais

Sem migração, contrato HTTP, dependência nova ou implantação. Os contratos atômicos/idempotentes existentes continuam preservados. O callback deve aguardar todas as escritas; o cliente transacional pertence somente a Infrastructure e ao escopo ativo. O cliente Prisma injetado no runner deve corresponder ao cliente do repositório.
