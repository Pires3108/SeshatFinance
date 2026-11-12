# ADR-036 — Cadeia de hash da auditoria financeira

**Status:** aceita em 12/11/2026 para a US-035.

**Referências:** RF-088; RNF-050; RII-013; INV-041; US-035, US-037; decisões registradas em SESHAT-51 em 27/09/2026 (lista permitida, append-only com detecção de adulteração) e no plano da S05 (cadeia SHA-256 por titular; cobertura somente de escritas financeiras).

## Contexto

A trilha `financial_audit_events` já era append-only: triggers rejeitam `UPDATE`, `DELETE` e `TRUNCATE`. Faltava detectar adulteração feita por quem contorna esses triggers, por exemplo desativando-os. Também faltavam os campos `result`, `error_code` e `correlation_id` da lista permitida de 27/09. Os eventos são emitidos por vários repositórios, sempre pela função `insertFinancialAuditEvent`, dentro da transação da escrita financeira.

## Decisão

- **Colunas novas:** cada evento recebe `owner_sequence` (1, 2, 3… por titular), `previous_hash` e `hash`, além de `result`, `error_code` e `correlation_id`.
- **Hash:** é o SHA-256 do texto canônico com os campos separados por `|`: sequência, hash anterior, id, titular, ator, ação, tipo e id do recurso, instante UTC com microssegundos, resultado, código de erro e correlação. O primeiro evento de cada titular aponta para 64 zeros.
- **Cálculo no banco:** um trigger `BEFORE INSERT` (`link_financial_audit_event`) calcula esses campos. Todos os emissores existentes ficam cobertos sem mudança, e a regra canônica existe em um único lugar (`financial_audit_event_hash`).
- **Concorrência:** a tabela `financial_audit_chain_heads` guarda o último elo de cada titular. O trigger trava essa linha com `FOR UPDATE`:
  - em Read Committed, inserções concorrentes do mesmo titular esperam e encadeiam em sequência;
  - em Serializable (ajuste de saldo), a concorrência vira erro de serialização, que o repositório já trata como 409 recuperável;
  - o índice único `(owner_id, owner_sequence)` garante que não haja bifurcação.
- **Migração:** a trilha existente é encadeada por titular na ordem `(occurred_at, id)`. O trigger append-only fica desativado apenas dentro da transação da migração.
- **Verificação:** `verify_financial_audit_chain(owner)` recalcula a cadeia. Devolve quantos eventos conferiu e a primeira sequência cuja posição, elo ou hash não confere.
- **Leitura:** a API expõe ao próprio titular `GET /api/v1/audit-events` (paginação por sequência, filtro por recurso, somente campos da lista permitida e da cadeia) e `GET /api/v1/audit-events/verification`.
- **Correlação:** o repositório de auditoria lê o id de correlação da requisição registrada pela API (`configureFinancialAuditCorrelation`). Um valor que não seja UUID v4 é gravado como nulo.
- **Resultado:** eventos gravados são sempre `succeeded`. Registrar tentativas que falharam fica fora deste escopo, porque exigiria gravar fora da transação que foi desfeita.
- **Cobertura:** somente escritas financeiras (contas, lançamentos, transferências, ajustes, cartões, cotações e reembolsos, estes como lançamentos). Classificações, entidades e grupos familiares ficam fora, conforme a decisão da S05.

## Consequências

- **O que é detectado:** alterar, apagar ou reordenar um evento, mesmo com os triggers desativados, quebra a cadeia daquele titular a partir do ponto alterado.
- **O que não é detectado:** quem tem acesso de escrita total ao banco pode recalcular toda a cadeia. Ancorar periodicamente o último hash fora do banco (backup, registro externo) fica como evolução e não faz parte desta decisão.
- **Desempenho:** as escritas financeiras do mesmo titular passam a ser serializadas no instante da auditoria. Titulares diferentes não competem entre si.
- **Fixtures de teste:** as que aplicam migrations manualmente precisam incluir `20261112120000_financial_audit_hash_chain`.

## Alternativas consideradas

- **Hash calculado na aplicação:** exigiria repetir a regra canônica em TypeScript e na migração de backfill, e confiar que todo emissor passe pelo mesmo código.
- **`pg_advisory_xact_lock` por titular:** em Serializable, a leitura do último elo usaria o snapshot da transação e poderia gerar sequência duplicada. A linha de cabeça com `FOR UPDATE` falha de forma explícita.
- **Assinatura com chave (HMAC):** exige gestão de segredo e rotação, sem decisão de produto registrada.
