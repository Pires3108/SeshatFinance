# Sprint 2 — Evidência de encerramento

**Data:** 15/10/2026. **Objetivo do roadmap:** permitir acesso seguro à aplicação. **Saída:** cadastro com confirmação de e-mail, login, recuperação de senha, sessão protegida, perfil inicial e proteção contra tentativas abusivas verificados com os serviços gratuitos do ambiente local.

| História | Jira      | PR integrado à `main`                                       | Evidência principal                                                                                           |
| -------- | --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| US-013   | SESHAT-29 | [#155](https://github.com/Pires3108/SeshatFinance/pull/155) | Cadastro e confirmação de e-mail por adaptador Supabase Auth.                                                 |
| US-014   | SESHAT-30 | [#113](https://github.com/Pires3108/SeshatFinance/pull/113) | Login, logout e tratamento seguro da sessão.                                                                  |
| US-015   | SESHAT-31 | [#156](https://github.com/Pires3108/SeshatFinance/pull/156) | Recuperação sem enumeração de usuários, com proteção contra reuso e expiração.                                |
| US-016   | SESHAT-32 | [#157](https://github.com/Pires3108/SeshatFinance/pull/157) | Resolução do ator autenticado na API e proteção de endpoints.                                                 |
| US-017   | SESHAT-33 | [#158](https://github.com/Pires3108/SeshatFinance/pull/158) | Perfil e preferências iniciais; moeda de apresentação restrita a BRL nesta etapa.                             |
| US-018   | SESHAT-35 | [#159](https://github.com/Pires3108/SeshatFinance/pull/159) | Limite de tentativas compartilhado no PostgreSQL, testes de integração entre instâncias e jornada Playwright. |

As seis histórias estão em **Concluído** no Jira e os PRs foram integrados à `main`. O job `quality` passou nos seis PRs, incluindo [o run 38576718197 da US-018](https://github.com/Pires3108/SeshatFinance/actions/runs/38576718197). A verificação local da US-018 passou em formatação, lint, tipos, testes unitários, nove suítes de integração PostgreSQL e quatro testes Playwright. A jornada local com Supabase Auth e Mailpit comprovou confirmação de cadastro, login, primeiro uso da recuperação, rejeição de reuso e expiração do token.

**Decisões de escopo e segurança:** senha com no mínimo 12 caracteres e proteção gratuita contra senhas comprometidas; bloqueio progressivo após cinco falhas, de 5 em 5 minutos até 60 minutos; identificação da origem pelo IP da conexão direta. A implantação atrás de proxy exige configuração explícita de proxies confiáveis, conforme ADR-033. A preferência de moeda permanece apenas BRL até o catálogo financeiro da US-021. A semântica de `Idempotency-Key` para escritas financeiras pertence à US-032.

**Portão para Sprint 3:** critérios de aceitação e cenários de autenticação cobertos pelas evidências dos tickets e PRs, com CI verde e nenhuma decisão ou defeito impeditivo aberto na Sprint 2. O roadmap foi revisto ao fim desta sprint; a ordem e o escopo da Sprint 3 permanecem os do documento de planejamento. Este registro será integrado após seu próprio CI verde. Nenhum deploy de produção faz parte deste encerramento.
