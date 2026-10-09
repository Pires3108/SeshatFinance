# Sprint 1 — Evidência de encerramento

**Data:** 09/10/2026. **Objetivo do roadmap:** construir a fundação transversal da API. **Saída:** um caso de uso de referência percorre HTTP, aplicação, domínio e PostgreSQL com teste.

| História | Jira      | PR integrado à `main` | Evidência principal                                                                                      |
| -------- | --------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| US-007   | SESHAT-23 | #132                  | Migrations, schema Prisma e seed sintético com proteção de identidade.                                   |
| US-008   | SESHAT-24 | #150                  | Erros seguros, correlationId, logs sem valores financeiros e ADR-031.                                    |
| US-009   | SESHAT-25 | #151                  | Contrato REST validado, OpenAPI e cliente sincronizados, teste de drift.                                 |
| US-010   | SESHAT-26 | #152                  | Cliente tipado consumido pelo web, erro seguro, sessão explícita e prova negativa de quebra de contrato. |
| US-011   | SESHAT-27 | #116                  | Fixture PostgreSQL isolada, rollback, integração Testcontainers.                                         |
| US-012   | SESHAT-28 | #128                  | Clock, gerador de IDs e transação injetáveis.                                                            |

As seis histórias estão em **Concluído** no Jira, com PRs integrados à `main` e CI verde no respectivo head. As verificações incluem formatação, lint, tipos, testes afetados, PostgreSQL e comparação do OpenAPI/cliente gerado.

**Critério de saída:** o PR #153 (integração `62e8bf8`) executa uma criação de conta sintética em `/api/v1/accounts` pela aplicação real, caso de uso e domínio, persistindo no PostgreSQL iniciado por Testcontainers. O teste confere resposta HTTP, moeda BHD com escala 3, unidades menores exatas, titularidade e evento de auditoria. A identidade externa é substituída apenas no resolvedor de ator do teste. O CI `quality` passou no head `15d617d` (run `37996586214`), incluindo integração PostgreSQL, formatação, build, lint, tipos, testes, bootstrap e checagens de OpenAPI e cliente.

**Decisão de escopo:** por decisão do responsável, a semântica HTTP do cabeçalho `Idempotency-Key` para transferências pertence à US-032/SESHAT-48 da Sprint 5. Os critérios e a rastreabilidade da US-009 e da US-032 foram atualizados; a Sprint 1 não implementa transferência.

**Portão para Sprint 2:** as seis histórias estão concluídas e seus PRs integrados. O teste da saída passou na `main` pelo PR #153. Nenhuma decisão ou defeito impeditivo da Sprint 1 permanece aberto. Este registro será integrado após seu próprio CI verde.
