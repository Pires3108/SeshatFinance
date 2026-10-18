# Registros de decisão arquitetural

Decisões arquiteturais significativas devem ser registradas aqui antes ou junto da implementação.

Use nomes no formato `NNNN-titulo-em-kebab-case.md`. Cada registro deve descrever contexto, decisão, consequências, alternativas consideradas e status.

1. Leia o [AGENTS.md da raiz](../../AGENTS.md) e as instruções locais aplicáveis. As instruções locais devem ser compatíveis com as regras da raiz.
2. Copie [o modelo](0000-template.md), atribua o próximo identificador livre e preencha as referências aos requisitos e invariantes afetados.
3. Registre alternativas e consequências antes ou junto da implementação. Vincule o ADR no [modelo de pull request](../../.github/pull_request_template.md).
4. Preserve os identificadores de decisões anteriores. Uma decisão substituta deve receber novo identificador e apontar para a decisão substituída.

O status de uma decisão não comprova a conclusão da implementação. As evidências dos critérios BDD, testes e publicação devem constar no pull request e no Jira.

- [ADR-001 — Receptor externo de eventos para espera do agente](0001-agent-webhook-waiter.md)
- [ADR-030 — Contexto transacional injetável](0030-contexto-transacional-injetavel.md)
- [ADR-031 — Correlação e metadados seguros entre processos](0031-correlacao-e-metadados-seguros.md)
