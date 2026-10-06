# ADR-030 — Contexto transacional injetável

## Status

Aceita para US-012; verificação da implementação registrada no PR correspondente.

## Contexto

A porta `TransactionRunner` existe em Application sem dependências de ORM. A persistência de transferências precisa gravar ambos os lados e auditoria com rollback integral, preservando INV-007, INV-008 e INV-046. O contexto transacional não pode atravessar o contrato de Application como um modelo Prisma.

## Decisão

Infrastructure implementa `PrismaTransactionRunner` com uma transação interativa PostgreSQL e contexto assíncrono privado por instância. O callback da porta continua sem argumentos de ORM. Adaptadores de persistência acessam o cliente transacional somente dentro do callback aguardado pelo runner. A persistência de transferências recebe esse adaptador por injeção, com uma instância padrão para os consumidores existentes.

Escopos aninhados são rejeitados explicitamente; este incremento não introduz composição arbitrária entre módulos. Todos os efeitos assíncronos de escrita devem ser aguardados dentro da operação. Exceções propagam a falha e acionam rollback; o resultado só é retornado após commit. O runner não substitui os contratos atômicos e idempotentes existentes dos repositórios.

## Consequências

Domain/Application permanecem independentes de Node, Prisma e PostgreSQL. Operações concorrentes não compartilham o cliente de outra execução. A integração real de transferências continua verificando rollback dos dois lados e da auditoria, além de idempotência e controle otimista. Não há mudança de schema nem de regra financeira.

A injeção deve utilizar o mesmo PrismaClient do repositório. Não se deve capturar o cliente transacional para uso após o callback ou lançar trabalho assíncrono sem aguardá-lo.

## Alternativas consideradas

- Expor Prisma.TransactionClient na porta: viola a independência de Application.
- Transação manual por conexão: duplica o controle de conexão, commit e rollback já fornecido pelo adaptador Prisma.
- Manter apenas chamadas diretas a `$transaction`: deixa a porta US-012 sem implementação de produção e sem consumidor verificável.

## Referências e rastreabilidade

- US-012 / [SESHAT-28](https://nicolaspires.atlassian.net/browse/SESHAT-28).
- Arquitetura 10; RNF-048/RNF-049; ET-003/ET-010; INV-007/INV-008/INV-046.
- `packages/application/src/ports/transaction-runner.ts`.
- `packages/database/src/prisma/prisma-transaction-runner.ts`.
- `packages/database/src/transfers/prisma-transfer-repository.integration.spec.ts`.
