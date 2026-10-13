# Estado da execução do backlog — 2026-10-07

Ponto de situação verificado em 2026-10-07, aproximadamente 15h12
(America/Sao_Paulo). Este registro é um handoff de execução; o Jira e os PRs
continuam sendo as fontes de verdade para prioridade, aceite, revisão e status.
Nenhuma das histórias abaixo foi declarada concluída.

## Ordem e decisões vigentes

- Executar histórias por prioridade do Jira e, no empate, pela ordem do backlog.
  Uma dependência necessária pode ser antecipada; uma história bloqueada não
  interrompe as demais.
- US-102: usar Supabase Auth para entrega. Para pessoa nova, convite de cadastro;
  para pessoa existente, magic link. No aceite, conferir e-mail confirmado da
  identidade/token, além do token próprio do convite, com 72 horas, uso único e
  revogação. Aceite é explícito e só então concede participação.
- US-082: a matriz versionada JSON/CSV foi autorizada como decisão de projeto,
  seguindo o contrato financeiro e práticas de interoperabilidade.
- Confirmações financeiras são apenas declarações do usuário sobre eventos
  externos. Nenhum incremento deve iniciar ou alterar transações financeiras.

## Incrementos publicados

| História / Jira                                                                               | Branches e PRs                                                                                                                                                                                                                                     | Evidência e situação                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-102 / [SESHAT-119](https://nicolaspires.atlassian.net/browse/SESHAT-119)                   | [#133](https://github.com/Pires3108/SeshatFinance/pull/133), [#137](https://github.com/Pires3108/SeshatFinance/pull/137), [#138](https://github.com/Pires3108/SeshatFinance/pull/138), [#139](https://github.com/Pires3108/SeshatFinance/pull/139) | Política/identidade confirmada, persistência de convite, API e entrega Supabase em PRs empilhados. Commits recentes: `f74226f` (#137), `65192d6` (#138), `6f558b0` e merge `1b8b09b` (#139). Jira: **Em Progresso**. |
| US-082 / [SESHAT-98](https://nicolaspires.atlassian.net/browse/SESHAT-98)                     | [#134](https://github.com/Pires3108/SeshatFinance/pull/134), [#140](https://github.com/Pires3108/SeshatFinance/pull/140)                                                                                                                           | Contrato JSON/CSV versionado, leitores autorizados e consultas limitadas; `4d80ea5` em #140. Jira: **Em Progresso**.                                                                                                 |
| US-083 / [SESHAT-99](https://nicolaspires.atlassian.net/browse/SESHAT-99)                     | [#135](https://github.com/Pires3108/SeshatFinance/pull/135)                                                                                                                                                                                        | Serialização XLSX como visão derivada, ainda sem jornada assíncrona completa. Jira: **Em Progresso**.                                                                                                                |
| US-085 / [SESHAT-101](https://nicolaspires.atlassian.net/browse/SESHAT-101)                   | [#136](https://github.com/Pires3108/SeshatFinance/pull/136), [#142](https://github.com/Pires3108/SeshatFinance/pull/142)                                                                                                                           | Contratos de job, persistência PostgreSQL, API e storage privado em PRs draft. #142 publicado até `6cdef31`; Jira: **Em Progresso**.                                                                                 |
| Correção transversal de CI / [SESHAT-20](https://nicolaspires.atlassian.net/browse/SESHAT-20) | [#141](https://github.com/Pires3108/SeshatFinance/pull/141)                                                                                                                                                                                        | Corrige três arquivos antigos que falhavam no `format:check`. PR pronto para revisão; quality e Vercel passaram na última verificação. Ainda não integrado a `main` ou às bases das outras branches.                 |

Os PRs empilhados permanecem abertos e alguns são draft. Publicar código e passar
testes locais não equivale ao aceite integral da história. Os comentários de
evidência mais recentes de US-102 foram registrados em SESHAT-119; os demais
tickets também receberam evidências por incremento.

## Trabalho local ainda não publicado

- `codex/us-085-runtime-wiring` recebeu o commit local `7a73752`,
  cherry-pick de `8d618cc`, com claim atômico, lease de cinco minutos e
  transições condicionais para impedir que um worker antigo sobrescreva um job.
  A branch estava um commit à frente de `origin` na verificação; o commit
  ainda não integra o PR #142.
- O worktree `codex/us-085-worker-processor` contém código de processamento
  JSON/CSV e arquivos ainda modificados/não rastreados. O agente foi
  interrompido antes da entrega. Não tratar esse código como verificado,
  publicado ou concluído.
- O checkout principal `D:\SeshatFinance` está na branch
  `codex/s16-public-journey-browser-validation` e possui muitas alterações
  preexistentes, inclusive arquivos de produto, arquitetura e API. Preservá-las
  e usar worktrees isolados.

## Verificação e falhas abertas

- US-102: os testes da Application (66), seu lint/typecheck, Prettier e
  `git diff --check` passaram localmente após `6f558b0`. Lint/typecheck da
  Database passaram localmente após `f74226f` e `65192d6`.
- O CI mais recente de #137 e #138 ainda falha no lint da Application: seis
  mocks `async` sem `await` em
  `manage-family-group-invitation.spec.ts`. A correção está só em #139;
  precisa ser levada à base da cadeia ou os PRs anteriores continuarão vermelhos.
- O CI mais recente de #139 passou por Application e Database, mas falha no
  lint da API: `z.string().email()` depreciado, função sem tipo explícito e
  duas anotações `import()` em tipos. Esses quatro erros ainda requerem
  correção. O Vercel também falha nos PRs da cadeia US-102 porque o projeto
  vinculado é `agent-waiter`, configurado com Root Directory
  `tools/agent-waiter`, ausente nessas branches.
- #136, #140 e #142 têm falha herdada de `format:check` nos três arquivos
  corrigidos em #141. A correção ainda precisa alcançar as bases relevantes.
- US-085: no worktree de runtime, typecheck da Database e Prettier dos dois
  arquivos de claim passaram; teste PostgreSQL de
  `prisma-export-job-repository.integration.spec.ts` terminou com **1 falha
  em 6 testes**. O caso de fencing tentou uma transição sem avançar
  `updatedAt`, lançando a exceção:
  `Export job transition must advance its fencing timestamp`. Corrigir
  contrato/teste conforme semântica pretendida e repetir
  integração antes de publicar `7a73752`.

## Lacunas de aceite identificadas

### US-102

- Autorizar criação/revogação no grupo e aplicar máximo de três convites
  pendentes, cooldown de reenvio (30 segundos, dobrando até 80 minutos) e
  substituição do convite anterior.
- Implementar saída/remoção com revogação imediata do contexto; proprietário
  não sai sem transferência. Preservar autoria e histórico autorizado.
- Corrigir a exposição do token bruto na resposta pública de criação e o
  convite pendente deixado por falha na entrega. Definir o comportamento
  idempotente para participante já existente.
- Integrar callback/sessão e aceite explícito na web; comprovar expiração,
  revogação, concorrência e rollback com PostgreSQL e Playwright.
- Por isso, US-104 / [SESHAT-120](https://nicolaspires.atlassian.net/browse/SESHAT-120)
  (Highest) continua dependente de US-102. A pré-análise já identificou
  transferência atômica de proprietário, reautenticação, papel explícito do
  antigo proprietário e testes de concorrência como próximos requisitos.

### US-082, US-083 e US-085

- A geração de US-085 ainda precisa de streaming/paginação antes de expor
  exportações de até 100 mil registros; o leitor atual materializa linhas
  antes de aplicar o limite. O worker em andamento só cobre JSON/CSV; XLSX
  ainda não está ligado à geração assíncrona.
- Faltam retry com limite/backoff, limpeza idempotente do objeto após 24 horas,
  UI de status/download e os testes de integração/Playwright que comprovem
  autorização atual, revogação imediata e expiração. O worker em progresso
  ainda não constitui evidência de aceite.

## Retomada segura

1. Corrigir os quatro erros de lint da API em #138 e propagar a #139; levar a
   correção dos mocks da Application a #137/#138. Reexecutar gates e atualizar
   SESHAT-119 com os resultados reais.
2. Concluir US-102 por critérios de aceite, em especial autorização, limites,
   saída e jornada web, antes de iniciar a dependente US-104.
3. Corrigir o teste/contrato de fencing de US-085, terminar e revisar o worker,
   integrar em #142, depois fechar streaming, XLSX, retry, limpeza e jornada web.
4. Integrar a correção transversal #141 às bases de PRs afetadas quando
   aprovada. Conferir o CI de cada branch; não inferir sucesso de um PR a
   partir de outro.
5. Para cada história, registrar no Jira branch/commit/PR, testes, gates,
   invariantes e pendências. Usar **Done** somente quando todos os critérios
   do AGENTS.md estiverem demonstrados.
