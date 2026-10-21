# Sprint 0 — Evidência de encerramento

**Data:** 08/10/2026. **Objetivo do roadmap:** permitir desenvolver, testar e executar localmente web, API e worker, com pipeline mínimo em pull requests.

| História | Jira      | PR integrado à `main` | Evidência principal                                                                                   |
| -------- | --------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| US-001   | SESHAT-17 | #144 (`b8f5b05`)      | Monorepo pnpm; smoke do processo web compilado.                                                       |
| US-002   | SESHAT-18 | #129 (`0a82af9`)      | TypeScript estrito, lint, formatação e testes de fronteiras arquiteturais.                            |
| US-003   | SESHAT-19 | #126 (`0ac50c1`)      | Bootstrap reproduzível do PostgreSQL local.                                                           |
| US-004   | SESHAT-20 | #130 (`63db431`)      | CI completo no head `cbb6477`; instalação imutável, gates negativos e proteção obrigatória de `main`. |
| US-005   | SESHAT-21 | #127 (`70e8338`)      | Instruções de agentes, ADRs, templates e rastreabilidade.                                             |
| US-006   | SESHAT-22 | #131 (`d4ba855`)      | Smoke dos processos API e worker compilados e health checks.                                          |

As seis histórias estão em **Concluído** no Jira e seus PRs foram integrados à `main`. A verificação de processo da web, API e worker e o bootstrap local de banco cobrem a saída operacional do roadmap. O workflow `CI` do PR #130 passou no commit `cbb6477` (run `37787835224`), incluindo formatação, build, lint, tipos, testes, bootstrap, integração PostgreSQL, OpenAPI e contrato de cliente. Não houve alteração de regra financeira; os gates de tipos monetários e limites entre módulos da US-002 seguem ativos.

**Decisão RII-025:** o responsável autorizou tornar `Pires3108/SeshatFinance` público. A `main` exige pull request e o check `quality` verde no commit atualizado, também para administradores. O PR temporário #146 demonstrou falha de lockfile e merge bloqueado; o PR temporário #147 demonstrou que erros reais de tipo e de teste falham, respectivamente, em `pnpm typecheck` e `pnpm test`. Ambos foram fechados sem merge. A decisão e os controles estão detalhados em `14-registro-de-riscos-e-inferencias-de-implementacao.md` e `docs/quality/11-ci-quality-gates.md`.

**Portão para Sprint 1:** nenhuma história da Sprint 0 permanece bloqueada ou em revisão. O commit de integração da US-004 em `main` (`63db431`) passou no run de CI `37788994867`. O registro de encerramento será integrado após seu próprio CI verde.
