# Matriz de rastreabilidade da Sprint 6 — cartões e faturas

**Data:** 13/11/2026. **História:** US-043 (SESHAT-59). **Escopo:** RF-038 a RF-046, RN-015 a RN-024, CA-008, INV-001, INV-002 e INV-014 a INV-018.

Cada invariante tem ao menos um teste que falha sob duplicação ou divergência. A suíte `packages/database/src/finance/s06-invariants.integration.spec.ts` usa os casos de uso reais em PostgreSQL. Depois de cada passo, ela recalcula por SQL independente o saldo da conta, a obrigação do cartão e o resultado de despesas, sem considerar a movimentação de quitação.

| Requisito / regra                | Invariante                                                | Testes que comprovam                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-038, RN-018, RII-015          | Ciclo único por data civil (base de INV-017)              | `card-cycle-schedule.spec.ts` (800 dias seguidos, meses curtos, bissexto, virada de ano, limite de fechamento); `brazil-holiday-calendar.spec.ts`; Playwright `cards.e2e.ts` (vencimento em feriado de SP deslocado)                                |
| RF-039, RN-015, CA-008           | INV-014 — compra reconhecida uma vez, sem reduzir a conta | `s06-invariants` (replay, payload divergente, 5 retries concorrentes); `prisma-card-purchase-repository.integration.spec.ts`; Playwright (saldo da conta inalterado)                                                                                |
| RF-044, RN-016                   | INV-015 — quitação não duplica despesa                    | `s06-invariants` (conta e obrigação caem pelo mesmo valor; despesa inalterada; total mensal de despesas 0,00); `list-temporal-transactions` exclui `cardSettlement`; gatilho que congela a movimentação; HTTP 409 ao alterar a movimentação isolada |
| RF-038, RF-046, RN-017           | INV-016 — limite apenas organizacional                    | `s06-invariants` (compra acima do limite aceita; limite inalterado); `credit-card.spec.ts`; texto "Limite organizacional" na interface                                                                                                              |
| RF-043 a RF-045, RN-022 a RN-024 | INV-017 — fatura reconciliável                            | `s06-invariants` (total = compras − quitações, igual ao SQL); `card-invoice.spec.ts`; fechamento concorrente gera uma fatura fechada e um evento `closed`; gatilho de imutabilidade                                                                 |
| RF-045, RN-023                   | INV-018 — pagamento parcial preserva a dívida             | `s06-invariants` (parcial mantém `overdue`; quitações concorrentes não ultrapassam a obrigação; excedente recusado; valor exato → `paid`); `invoice-due-state.spec.ts`                                                                              |
| RN-001, INV-001, INV-002         | Isolamento por titular e moeda explícita                  | `s06-invariants` (outro titular e outra moeda recusados sem escrita); e2e HTTP de cartão, compra, fatura e quitação; repositórios com chave composta por titular                                                                                    |
| RF-046, CA-011, CA-021           | Estados acessíveis                                        | `invoice-due-state.spec.ts` (instante do vencimento, mês curto, feriado, fuso); `invoice-state.spec.ts`; Playwright (rótulos "Vencida há", "Em dia", "Quitada")                                                                                     |
| INV-041, ADR-036                 | Cadeia de auditoria íntegra                               | `s06-invariants` (verificação da cadeia do titular após todos os cenários)                                                                                                                                                                          |

## Fronteira operacional

`tools/verify-operational-boundary.mjs`, executado por `pnpm test`, bloqueia provedores de pagamento e operações de execução financeira. Nenhum código da S06 inicia, autoriza, bloqueia ou altera transação externa. A interface de quitação informa que nada é pago pela aplicação.

## Jornada ponta a ponta (CA-008)

O arquivo Playwright `apps/web/tests/e2e/cards.e2e.ts` contém cinco cenários, todos contra a API real e o PostgreSQL:

1. cadastro e edição do cartão, com local de feriados;
2. compra registrada pela tela;
3. fechamento manual e compra posterior roteada para a próxima fatura;
4. quitação parcial pela tela, com saldo antes e depois, excedente recusado e despesas mensais inalteradas;
5. estados vencida, em dia e quitada.
