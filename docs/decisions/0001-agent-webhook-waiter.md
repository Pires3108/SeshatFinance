# ADR-001 — Receptor externo de eventos para espera do agente

## Status

Aceita.

## Contexto

Uma tarefa de desenvolvimento pode depender do fim de uma execução de CI ou de
uma mudança de status no Jira. Consultas repetidas usam tempo de raciocínio sem
produzir trabalho útil. Esses serviços já emitem eventos de conclusão, mas a
aplicação financeira não deve armazenar o estado operacional de agentes nem
receber segredos de integrações de desenvolvimento.

## Decisão

Hospedar um receptor independente em Vercel, em `tools/agent-waiter`, com
persistência temporária em Upstash Redis. O host do agente registra uma
correlação de curta duração para a chamada de ferramenta. O receptor valida o
corpo bruto com HMAC, identifica apenas eventos terminais e envia um callback
assinado ao host do agente. Este último retoma a chamada pelo `callId` original.

O serviço não acessa API, banco ou tabelas da Seshat Finance; não registra
valores financeiros nem corpos de eventos de provedores.

## Consequências

- Elimina polling pelo host do agente para execuções cobertas por webhooks.
- Exige um projeto Vercel, um Redis de curta retenção e segredos configurados
  fora do repositório.
- O host do agente continua responsável por idempotência e por retomar a
  conversa na API de agentes; o receptor não retoma sessões do Codex Desktop.
- Falhas de callback devolvem erro ao provedor para permitir nova entrega.

## Alternativas consideradas

- Polling com intervalos fixos: simples, mas consome tempo do agente e atrasa a
  continuação.
- Armazenar a correlação no banco financeiro: viola a separação entre o produto
  e a infraestrutura operacional de desenvolvimento.
- Aguardar dentro de uma função Vercel: é limitado por duração de execução e
  não é durável entre invocações.
