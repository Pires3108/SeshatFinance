# ADR-031 — Correlação e metadados seguros entre processos

## Status

Aceita para US-008; verificação da implementação registrada no PR correspondente.

## Contexto

A API precisa devolver o mesmo identificador opaco nas respostas de erro e nos metadados de log, inclusive quando uma falha ocorre antes de um interceptor de controller. Mensagens de exceção, argumentos de logger e payloads de jobs podem conter valores financeiros ou segredos. O worker ainda não executa jobs de produção, mas seus futuros handlers precisam de uma fronteira de observabilidade consistente.

## Decisão

O pacote `@seshat/observability` fornece um contexto de correlação por operação assíncrona e um contrato fechado de metadados de log. A API valida o cabeçalho de correlação como UUID opaco e gera outro identificador quando o valor externo não atende ao formato; um hook de entrada associa o identificador à requisição antes dos handlers Nest. O filtro de exceções registra somente ação, tipo de recurso, resultado, duração e correlação, além de enviar envelope público com código estável e mensagem segura em pt-BR.

O worker usa o mesmo contrato por meio de `WorkerJobRunner`. O adaptador é testado com handler e sink reais em memória; sua conexão a jobs de produção será feita quando esses jobs existirem. Entradas de log são reconstruídas por allowlist antes de chegar ao sink. Mensagens, descrições, valores, tokens, e-mails, contas, OTPs e anexos não fazem parte desse contrato.

## Consequências

Um identificador arbitrário enviado pelo cliente não é refletido em resposta nem log. Falhas assíncronas e de autorização antecipada conservam a correlação. A API e o worker compartilham apenas o contrato de observabilidade; Domain e Application não dependem de HTTP, Node ou provider. O contexto assíncrono é restrito ao ciclo da operação e deve ser iniciado pelo adaptador de entrada de cada processo.

O worker ainda não possui fluxo de jobs registrado no ponto de entrada; o teste do adaptador não afirma execução de um job de produção. Erros de parsing gerados pelo servidor HTTP antes do filtro Nest exigem verificação separada quando essa superfície fizer parte de uma jornada crítica.

## Alternativas consideradas

- Aceitar qualquer texto do cabeçalho como correlação: permite refletir segredos enviados pelo cliente.
- Registrar mensagens e objetos de exceção com mascaramento posterior: amplia a superfície de vazamento e depende de reconhecer todo dado sensível.
- Implementar contratos de log independentes na API e no worker: facilita divergência das políticas de privacidade.

## Referências e rastreabilidade

- US-008 / [SESHAT-24](https://nicolaspires.atlassian.net/browse/SESHAT-24); RNF-019/RNF-023/RNF-032; INV-041/INV-042.
- `packages/observability/src/correlation-context.ts` e `safe-log-metadata.ts`.
- `apps/api/test/error-envelope.e2e.spec.ts` e `apps/worker/src/job-runner.spec.ts`.
