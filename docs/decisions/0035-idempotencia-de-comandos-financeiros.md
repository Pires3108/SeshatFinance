# ADR-035 — Idempotência de comandos financeiros compostos

**Status:** aceita para US-032 em 12/11/2026; a US-033 reutiliza o mesmo mecanismo.

**Referências:** RII-017; RNF-049; RF-028; INV-007, INV-008; US-032, US-033, US-037; decisão registrada em SESHAT-48 e SESHAT-49 em 28/09/2026.

## Contexto

Transferências e ajustes são gravados atomicamente, mas cada requisição gera novos identificadores. Se a gravação for confirmada e a resposta se perder, repetir o mesmo `POST` criaria outro par ou outro ajuste. A decisão de 28/09/2026 exige `Idempotency-Key` UUID v4 única por usuário e operação, com chave e hash do conteúdo normalizado gravados na mesma transação da escrita financeira, da auditoria e da resposta; repetição idêntica por 24 horas devolve a resposta original; conteúdo divergente ou execução concorrente retorna 409 sem escrita.

Lançamentos (`transaction_idempotency`), reembolsos e cotações manuais já possuem mecanismos próprios, sem expiração nem resposta gravada.

## Decisão

- Tabela genérica `idempotency_records` com chave primária `(owner_id, operation, key)`, `payload_hash` SHA-256 do conteúdo normalizado em ordem estável de campos, `response` e `expires_at = requested_at + 24h`.
- Application define `IdempotencyRequest`, `normalizeIdempotencyKey`, `IdempotencyConflictError` e `InvalidIdempotencyKeyError`. O caso de uso valida a chave, normaliza o conteúdo e obtém o instante do `Clock` injetado.
- O caso de uso consulta a chave antes de validar contas, para que a repetição devolva a resposta original mesmo após mudanças de ciclo de vida ou de estado das contas.
- O repositório financeiro, dentro da mesma transação do `PrismaTransactionRunner`, executa `pg_try_advisory_xact_lock` sobre `(titular, operação, chave)`. Lock ocupado retorna 409 imediatamente. Em seguida reconsulta o registro: hash igual devolve a resposta gravada sem escrita; hash diferente retorna 409. Sem registro vigente, grava a escrita financeira, a auditoria e o registro de idempotência, substituindo um registro expirado da mesma chave.
- Qualquer falha antes do commit desfaz tudo e libera a chave. Depois do commit, a repetição é segura.
- A resposta gravada é o snapshot do recurso no momento do registro; a API deriva o corpo HTTP dele deterministicamente.
- A API exige o cabeçalho em `POST /api/v1/transfers`: ausente ou fora de UUID v4 retorna 400; conflito retorna 409.

## Consequências

- Registros expirados deixam de ser considerados imediatamente e são substituídos na reutilização da chave. A remoção física de expirados fica disponível por `deleteExpiredIdempotencyRecords` para um job de manutenção.
- Duas requisições concorrentes com a mesma chave produzem no máximo uma escrita financeira e um evento de auditoria; a perdedora recebe 409 ou, se chegar após o commit, a resposta original.
- Os mecanismos existentes de lançamentos, reembolsos e cotações permanecem inalterados nesta decisão.

## Alternativas consideradas

- Tabela por recurso, como no esboço anterior da US-032: duplicaria lógica de bloqueio, hash e expiração.
- Executor genérico com transação própria envolvendo o repositório: exigiria transações aninhadas, proibidas pelo ADR-030.
- Bloqueio com espera (`pg_advisory_xact_lock`): serializaria a segunda requisição em vez de responder 409 durante execução concorrente, contrariando a decisão registrada.
