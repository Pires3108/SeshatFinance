# Seshat Finance — estado do desenvolvimento em 23/09/2026

Este é um retrato verificável do repositório até o PR [#77](https://github.com/Pires3108/SeshatFinance/pull/77), integrado à `main` no commit `8432b6e7c06e3413824be31b2c18cebcedb6ab56`. Não substitui o [backlog oficial](13-backlog-roadmap-e-sprints-seshat-finance.md), não declara nenhuma sprint encerrada e deve ser atualizado quando o estado mudar. O repositório remoto é privado (`Pires3108/SeshatFinance`).

## Entregue no código

- **Fundação:** monorepo pnpm com web, API, worker e pacotes de domínio, aplicação, infraestrutura e contratos; TypeScript estrito, lint, formatação, testes, OpenAPI/cliente tipado, PostgreSQL/Prisma, CI e health checks. O hook `preToolUse` em `.cursor/hooks.json` impede commits em `main` ou HEAD destacado e tem testes próprios. Cada incremento vem sendo desenvolvido em branch descritiva e publicado por PR.
- **Identidade:** API de cadastro com solicitação de confirmação de e-mail, recuperação de senha e resolução de ator via bearer; perfil do usuário protegido. A web tem página de cadastro em pt-BR e encaminha a solicitação à API sem devolver credenciais ou erros do provedor. Não há login nem sessão web publicados.
- **Livro financeiro:** `Money` e `Currency` com precisão decimal explícita; contas com consulta, edição, ciclo de vida, tipos padrão e saldo calculado; receitas e despesas com consulta, edição, classificações e ciclo de vida; categorias, etiquetas e centros de custo com ownership; transferências pareadas e ajustes de saldo; auditoria financeira append-only com metadados mínimos. A API é a fronteira de escrita financeira.
- **Cartões e investimentos:** cadastro e consulta de cartão de crédito, sem materialização de faturas; catálogo dos tipos de investimento, sem posições ou cálculos de rentabilidade.
- **Qualidade financeira:** testes de domínio, API e persistência, incluindo isolamento por proprietário, concorrência, atomicidade de transferências e ajustes e equação de saldo. O PR #77 acrescentou no PostgreSQL a prova de `0,10 + 0,20 − 0,05 = 0,25`, preservação do efeito ao arquivar conta/movimentação e retirada/restauração do efeito da lixeira.

Essas entregas são incrementos técnicos, não a comprovação integral dos critérios de aceitação de suas histórias. As interfaces de uso financeiro, os fluxos completos de autenticação e grande parte do roadmap ainda não foram entregues.

## Estado por grupo de sprints

- **Sprints 0–1:** fundação implementada e verificada no CI; a execução local de migration, seed e testes PostgreSQL pelo Compose continua pendente do Docker Desktop (RII-003).
- **Sprint 2:** cadastro e recuperação têm API, e cadastro tem tela web. Login, sessão segura, MFA e limitação progressiva ainda não atendem CA-001/CA-002 (RII-004 a RII-006).
- **Sprints 3–5:** núcleo de contas, movimentações, classificações, transferências, ajustes e auditoria avançou. Não há interface financeira completa; entidades, visões calendáricas, reembolso e idempotência de comandos compostos seguem pendentes. US-024 ainda não cobre todos os invariantes enumerados.
- **Sprint 6:** somente cadastro e leitura de cartões; compras, faturas e quitação não estão implementadas.
- **Sprints 7–16 e pós-MVP:** permanecem majoritariamente no backlog. A exceção identificada é o catálogo de tipos de investimento da Sprint 9. Não há evidência de MVP, release candidate ou deploy em produção.

## Decisões e validações pendentes

O [registro RII](14-registro-de-riscos-e-inferencias-de-implementacao.md) é a fonte para o estado detalhado e a condição de resolução de cada risco. As decisões mais próximas do caminho crítico são sessão e política de senha (RII-004 a RII-006), moeda/arredondamento (RII-007), semântica de classificações e entidades (RII-010 e RII-011), calendário (RII-012), reembolso (RII-014), ciclo de cartão (RII-015), precisão de investimento (RII-016) e idempotência de comandos financeiros compostos (RII-017). Não preencher essas lacunas por inferência.

O PR #77 passou na checagem `quality`, incluindo `pnpm test:integration` com PostgreSQL no CI. Localmente, formatação, lint, tipos e testes gerais passaram após regerar o cliente Prisma sequencialmente; a execução simultânea desses comandos disputou os arquivos gerados e produziu falhas transitórias. O Docker Desktop local não estava disponível. Esses resultados não equivalem a testes ponta a ponta com Supabase real nem a validação de produção.

## Próxima retomada segura

1. Escolher um incremento independente das decisões RII abertas, conferir requisitos, regras, invariantes e critérios de aceitação correspondentes.
2. Criar branch própria, implementar, testar, inspecionar o diff, publicar PR e acompanhar CI/comentários antes da integração.
3. Registrar toda alteração relevante no ticket Jira correspondente, com validação, commit/branch e estado real do deploy. Sem confirmação de produção e pedido explícito, não mover ticket para `Concluído`.

O objetivo continua sendo concluir **todas** as sprints do [roadmap](13-backlog-roadmap-e-sprints-seshat-finance.md), inclusive pós-MVP; este documento não reduz esse escopo.
