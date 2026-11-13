# ADR-038 — Compra no cartão como fato financeiro próprio

**Status:** aceita para US-039 em 13/11/2026 (proposta original em 05/10/2026 na branch de trabalho da US-039).

**Referências:** RF-039; RN-001, RN-015, RN-017; CA-008; INV-001, INV-014, INV-016; RII-015, RII-017; ADR-035, ADR-037; US-039, US-040, US-041; SESHAT-55.

## Contexto

`Transaction` representa movimentação de uma conta, e toda despesa ativa reduz o saldo dela. A compra no cartão, conforme US-039 e INV-014, reconhece despesa e obrigação do cartão, mas não reduz a conta pagadora antes da quitação declarada.

## Decisão

- **Fato próprio.** `CardPurchase` é persistida em `card_purchases`, vinculada ao cartão e ao titular por chave composta. Cada linha é uma despesa e o mesmo valor de obrigação do cartão. O registro não cria `Transaction` na conta pagadora.
- **Ciclo único.** A compra recebe `cycle_closes_on`, a data de fechamento do único ciclo que contém a data civil do instante da compra no fuso do titular, segundo ADR-037. O cálculo é feito uma vez no registro e não muda depois.
- **Idempotência.** O registro usa o contrato da ADR-035 com a operação `card-purchase.create`: `Idempotency-Key` UUID v4, hash do conteúdo normalizado, 24 horas de replay e 409 para conteúdo divergente ou concorrente. Compra, auditoria `created` do recurso `card-purchase` e registro de idempotência são gravados na mesma transação. Isso substitui a chave e a impressão digital próprias da proposta original.
- **Moeda.** A compra deve estar na moeda do cartão. Outra moeda retorna 422 (`UNPROCESSABLE_REQUEST`), conforme decisão do titular do produto em 13/11/2026; a conversão fica pendente.
- **Categoria.** A categoria é opcional e precisa pertencer ao titular.

## Consequências

- A despesa e a obrigação da compra aparecem na fatura do ciclo, que a US-040 materializa. A US-041 registra a quitação declarada e seu efeito na conta.
- As visões temporais de movimentações das contas não incluem compras no cartão. Uma visão consolidada de despesas que as inclua fica para a história de relatórios.
- Edição, estorno e lixeira de compras não são expostos até existirem fatos compensatórios auditáveis.
