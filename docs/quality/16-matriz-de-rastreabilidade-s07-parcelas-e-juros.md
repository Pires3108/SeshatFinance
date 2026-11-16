# Matriz de rastreabilidade da Sprint 7 — parcelas, juros e empréstimos

**Data:** 16/11/2026. **História:** US-048 (SESHAT-64). **Escopo:** RF-035, RF-040 a RF-045, RN-018 a RN-023, CA-009, INV-003 a INV-005, INV-017 a INV-019 e INV-048, conforme ADR-042.

Cada invariante tem testes de propriedade, de exemplo e de integração que falham diante de centavo perdido, efeito duplicado ou histórico apagado. A suíte `packages/database/src/finance/s07-invariants.integration.spec.ts` usa os casos de uso reais em PostgreSQL. A cada passo, ela recalcula por SQL independente:

- os totais de cada plano e de cada parcela;
- as cobranças de cada fatura depois de parcelamento, antecipação, reversão e renegociação;
- o saldo pendente de um empréstimo depois de pagamentos repetidos e de uma reversão.

Todo o cálculo de dinheiro e de taxa usa `bigint` e frações exatas. A regra `precise-money` e os tipos impedem `number` nesses valores.

| Requisito / regra                | Invariante                                                            | Testes que comprovam                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-018, RII-007                  | INV-005 — repartição sem perda de centavo                             | `money.spec.ts`; propriedades de `installment-plan.spec.ts` e `loan-schedule.spec.ts` (BRL/USD/EUR, até 420 parcelas: soma das parcelas = total, soma dos principais = principal); `s07-invariants` (soma SQL das parcelas = total do plano; principal do plano raiz = valor da compra)                                                                                                                          |
| RN-019 a RN-021, US-045          | INV-019 — principal + juros = total apresentado                       | propriedades (juros por parcela ≥ 0, principal ≥ 0, principal + juros = parcela, determinismo, total ≥ principal); exemplos 102,00 / 102,01, 1,99% em 12 períodos e 1,00 × 2⁴²⁰; arredondamento único (1,00 a 1,5% → 1,03); juros por fatia acumulada; Playwright (prévia com memória de cálculo)                                                                                                                |
| RF-043 a RF-045, RN-022          | INV-017 — fatura reconciliável com parcelas e mudanças                | `s07-invariants` (total de cada fatura = SQL independente depois de cada operação); `prisma-card-installment-plan-changes.integration.spec.ts` (93,33 / 0,00 / 0,00 depois da antecipação; linhas do detalhe somam o total); Playwright (antecipação e reversão pela tela)                                                                                                                                       |
| RF-045, RN-023                   | INV-018 — pagamento parcial preserva a dívida                         | quitações da S06 (excedente recusado); parcelamento e mudanças recusados quando as quitações já declaradas superariam a nova obrigação (`CardInstallmentSettledAboveObligationError`); `loan-ledger.spec.ts` (40 pagos → 60 pendentes)                                                                                                                                                                           |
| RF-035, RN-023, RII-019          | INV-048 — saldo pendente de empréstimo reconciliável                  | `loan-ledger.spec.ts` (alocação multa → juros → principal e substituição por evento; atraso a partir do dia seguinte ao vencimento efetivo; multa declarada prevalece; excedente classificado; quitação com desconto; reversão; renegociação); `prisma-loan-repository.integration.spec.ts` (4 pagamentos concorrentes → sequências 1 a 4); `s07-invariants` (pendente = cronograma − pagamentos ativos, em SQL) |
| RN-072, RN-073, ADR-035, ADR-042 | Retry e concorrência não multiplicam efeitos; histórico não é apagado | chaves idempotentes em parcelamento, mudanças de plano, empréstimos e eventos (replay idêntico; payload divergente → conflito); 3 confirmações concorrentes → 1 plano; gatilhos que rejeitam `UPDATE` e `DELETE` em parcelas, mudanças, empréstimos e eventos                                                                                                                                                    |
| INV-001, INV-002                 | Isolamento por titular e moeda explícita                              | casos de uso com escopo de titular; e2e HTTP (401 anônimo, 404 para outro titular); eventos em outra moeda recusados no Domain                                                                                                                                                                                                                                                                                   |

## Mutação direcionada

O comando `pnpm --filter @seshat/domain test:mutation` (`packages/domain/scripts/s07-mutants.mjs`) roda no CI logo depois de `pnpm test`. Ele aplica um defeito nomeado por vez aos algoritmos do Domain e exige que os testes que protegem aquele código falhem. Se algum mutante sobreviver, o CI falha. O critério é a lista nomeada abaixo, sem percentual global. Os arquivos-fonte são restaurados ao fim de cada mutante.

| Mutante                            | Defeito                                                  | Protege    |
| ---------------------------------- | -------------------------------------------------------- | ---------- |
| `last-cent-dropped`                | última parcela perde o resíduo                           | INV-005    |
| `half-up-to-half-down`             | empates arredondados para baixo                          | RII-007    |
| `early-rounding`                   | montante composto arredondado depois do primeiro período | RII-007    |
| `simple-interest-operator`         | juros simples subtraídos                                 | RN-020     |
| `period-shifted`                   | um período de capitalização perdido                      | RN-020     |
| `rate-scale`                       | percentual lido na escala errada                         | US-045     |
| `interest-equal-split`             | juros divididos igualmente, sem fatia acumulada          | INV-019    |
| `price-amortization-shifted`       | amortização acumulada do Price deslocada em um período   | ADR-042    |
| `allocation-order-inverted`        | prioridade de alocação invertida                         | ADR-042    |
| `future-installments-eligible`     | parcelas futuras tratadas como obrigação vencida         | US-046/047 |
| `delay-on-due-date`                | atraso e multa já no dia do vencimento                   | RII-019    |
| `loan-prepayment-discount-ignored` | desconto da quitação de empréstimo ignorado              | INV-048    |
| `card-prepayment-discount-ignored` | desconto da antecipação no cartão ignorado               | INV-017    |

Resultado em 16/11/2026: 13 de 13 mutantes eliminados. A primeira execução encontrou dois sobreviventes, que viraram testes novos:

- `early-rounding`: o teste do arredondamento único com 1,00 a 1,5%;
- `interest-equal-split`: o teste da fatia acumulada com 1,00 a 0,5% em 4x.

Mais um mutante foi descartado por ser equivalente: deslocar o principal-alvo da última parcela do Price. O limite inferior força a última parcela a fechar o principal de qualquer forma, então nenhum teste poderia distinguir essa mutação. Ele foi trocado por `price-amortization-shifted`.

O Stryker não foi adotado. Ele exigiria editar à mão uma árvore extensa de dependências no lockfile, sem dar critério melhor que esta lista nomeada. A decisão pode ser revista quando a regeneração do lockfile voltar a ser confiável.

## Fronteira operacional

Parcelamento, antecipação, renegociação, pagamentos e quitações são declarações organizacionais do titular. Nenhuma operação envia ordem a emissor, credor ou devedor, nem movimenta dinheiro. Nenhum deploy de produção faz parte desta sprint.
