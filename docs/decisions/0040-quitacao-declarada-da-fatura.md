# ADR-040 — Quitação declarada da fatura

**Status:** aceita para US-041 em 13/11/2026.

**Referências:** RF-044, RF-045; RN-001, RN-015, RN-016, RN-023; CA-008; INV-001, INV-002, INV-015, INV-017, INV-018; ADR-034, ADR-035, ADR-038, ADR-039; US-041; SESHAT-57.

## Contexto

A quitação registra um pagamento que o titular declara ter feito fora da Seshat Finance. Ela precisa reduzir a conta escolhida e a obrigação da fatura pelo mesmo valor, sem criar nova despesa, e precisa resistir a retry, duplo clique e pagamentos concorrentes acima da obrigação.

## Decisão

- **Movimentação vinculada.** A quitação grava uma movimentação de saída (`expense`) na conta escolhida e a linha `invoice_settlements`, que referencia a fatura, a conta e essa movimentação (vínculo único). O saldo da conta continua calculado pelas movimentações, sem segunda fonte.
- **Sem nova despesa.** As visões temporais marcam a movimentação como `cardSettlement` e não a somam em receitas nem despesas (INV-015). A despesa permanece apenas na compra.
- **Movimentação congelada.** Edição, classificação, etiquetas, ciclo de vida e eliminação da movimentação isolada retornam 409; um gatilho no PostgreSQL rejeita mudança de valor, tipo, conta, data, moeda, ciclo de vida ou eliminação. A reinterpretação de fuso (ADR-034) continua permitida.
- **Remanescente e excedente.** Sob bloqueio da fatura, o remanescente é a soma das compras menos as quitações. Valor acima do remanescente retorna 422 sem escrita, conforme decisão do titular do produto em 13/11/2026; isso também impede que pagamentos concorrentes ultrapassem a obrigação. Pagamento parcial mantém o remanescente (INV-018).
- **Idempotência.** Contrato da ADR-035 com a operação `invoice-settlement.create`. Movimentação, quitação, auditorias `created` dos recursos `transaction` e `invoice-settlement` e o registro de idempotência são gravados na mesma transação.
- **Moeda e conta.** A conta deve ser do titular, estar ativa e ter a moeda do cartão; caso contrário, 404 ou 422.

## Consequências

- O excedente e a sua classificação ficam pendentes.
- A correção de uma quitação exige um fato de reversão auditável, ainda não exposto.
- A fatura pode receber quitação aberta ou fechada; os estados vencida e quitada são derivados na US-042.
