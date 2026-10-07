# ADR-014 — Jobs de exportação privados e assíncronos

- **Status:** em implementação
- **Data:** 2026-10-07
- **Histórias:** US-082 a US-085

## Contexto

Exportações podem conter dados financeiros sensíveis e levar mais tempo que uma requisição HTTP. O contrato v1 define seleção filtrada, representação decimal e limite explícito. A API precisa congelar o pedido, manter o arquivo privado e revalidar acesso no download.

## Decisão

- A API cria um job persistido com chave de idempotência única por ator. Repetições só podem reutilizar o job quando formato, filtros normalizados e zona coincidirem; a autorização é revalidada.
- O pedido e os filtros autorizados ficam congelados no job. O worker deve revalidar o acesso antes de ler os dados e gravar o artefato.
- O artefato usa um bucket Supabase Storage privado. O adapter consulta a configuração do bucket e rejeita operações se ele for público. A API emite URL assinada por no máximo dez minutos após nova verificação de acesso.
- O job expira após 24 horas; a limpeza remove o objeto e marca o estado `expired` de forma idempotente.
- Os endpoints HTTP expõem apenas estado e metadados necessários, sem conteúdo financeiro ou chave de storage.

## Estado e consequências

Persistência PostgreSQL, contratos, controller e storage privado estão em implementação. O processador no worker, a política de retry/backoff e a limpeza agendada ainda precisam ser conectados antes de considerar US-085 concluída. A geração deve consumir os leitores limitados de US-082 e não materializar resultado sem limite.
