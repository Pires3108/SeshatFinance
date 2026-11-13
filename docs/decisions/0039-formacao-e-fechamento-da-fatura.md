# ADR-039 — Formação e fechamento manual da fatura

**Status:** aceita para US-040 em 13/11/2026.

**Referências:** RF-038, RF-043; RN-022 a RN-024; CA-008; INV-014, INV-017; RII-015; ADR-037, ADR-038; US-040, US-041, US-042; SESHAT-56.

## Contexto

A US-040 exige que cada compra componha exatamente uma fatura, que a fatura preserve a regra e a versão de calendário usadas, que o fechamento manual seja idempotente e transacional, e que correções posteriores tenham fatura de destino explícita.

## Decisão

- **Uma fatura por ciclo.** `card_invoices` é única por titular, cartão e data de fechamento. A fatura é formada com a primeira compra do ciclo e congela datas (primeira e última data de compra, fechamento, vencimento programado e efetivo), regra de fechamento, versão do dataset de feriados, fuso e moeda.
- **Roteamento sob bloqueio.** O registro da compra forma ou bloqueia (`FOR UPDATE`) a fatura do ciclo e as seguintes, em ordem, e usa a primeira aberta. Compra e fechamento serializam no mesmo bloqueio, então uma compra nunca entra numa fatura fechada.
- **Compra após o fechamento.** Decisão do titular do produto em 13/11/2026: quando a fatura do ciclo da compra já está fechada, a compra entra na próxima fatura aberta do cartão, com `posted_after_close = true` e a data original preservada. A fatura fechada nunca é reescrita.
- **Fechamento manual.** `POST /api/v1/credit-cards/:cardId/invoices/:closesOn/close` congela o total de compras (`closed_total`) e grava a auditoria `closed` do recurso `card-invoice` na mesma transação. Repetir o comando devolve a mesma fatura fechada sem nova escrita. O fechamento não cria despesa nem altera a conta pagadora. O comando é idempotente pelo estado, sem `Idempotency-Key`.
- **Imutabilidade.** Um gatilho no PostgreSQL rejeita qualquer alteração de fatura fechada.
- **Componentes e totais.** O total de compras é a soma das compras da fatura; `settledTotal` e `remaining` existem no contrato, e as quitações declaradas entram na US-041 (INV-017).

## Consequências

- O fechamento é sempre manual; a notificação de data prevista depende da central de notificações e não fecha a fatura.
- Créditos, estornos e encargos ainda não existem como componentes; dependem de fatos compensatórios auditáveis.
- Os estados vencida e quitada são derivados na US-042.
