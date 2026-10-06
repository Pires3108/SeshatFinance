# US-005 — Colaboração e rastreabilidade

## Escopo

SESHAT-21 / US-005 consolida as instruções de colaboração, o modelo de ADR e o modelo de pull request. Não altera comportamento financeiro nem atribui novos identificadores aos requisitos existentes.

## Evidências dos cenários BDD

- Decisão arquitetural: o [modelo de ADR](../decisions/0000-template.md) contém status, contexto, decisão, consequências, alternativas e referências. O [guia](../decisions/README.md) explica a atribuição de novo identificador sem reescrever decisões anteriores.
- Mudança financeira: o [modelo de PR](../../.github/pull_request_template.md) exige critérios BDD, invariantes afetados e evidências dos testes. O [PR 124](https://github.com/Pires3108/SeshatFinance/pull/124) é um exemplo real de apresentação do saldo derivado; sua implementação preserva INV-006, INV-009 e INV-010 e foi verificada com 9 cenários Playwright, incluindo API/PostgreSQL reais.
- Instruções locais: [AGENTS.md](../../AGENTS.md) registra as regras fornecidas pelo responsável do projeto, inclusive recuperação do Docker e atualização obrigatória do Jira. O guia de ADR exige compatibilidade das instruções locais com a raiz.
- Rastreabilidade arquitetural: [ADR-013 de sessões opacas](https://github.com/Pires3108/SeshatFinance/blob/aa2bb6c2bc380185f4f9e27ef82285edd341a276/docs/decisions/0013-sessoes-opacas.md), implementado no [PR 113](https://github.com/Pires3108/SeshatFinance/pull/113), exemplifica decisão com contexto e consequências. A referência não comprova todos os gates desse PR; sua verificação permanece registrada no próprio incremento.

## Verificação deste incremento

O incremento contém apenas instruções e modelos Markdown. Não modifica código, dependências, migrações ou contratos; lint, tipos e testes de execução não têm arquivos afetados. A verificação aplica formatação aos quatro documentos alterados e a este relatório, revisão dos links locais e `git diff --check`.

A formatação geral da base possui três pendências já identificadas e tratadas no incremento US-004. A conclusão deste incremento não declara que os gates de histórias independentes passaram.

## Riscos e operação

Nenhuma decisão arquitetural significativa nova foi tomada. Não há implantação de aplicação neste incremento. A aplicação prática do modelo está no PR deste incremento e no exemplo financeiro citado; resultados pendentes devem permanecer explícitos no Jira.
