# Sprint 7 — Evidência de encerramento

**Data:** 16/11/2026. **Objetivo do roadmap:** controlar compromissos parcelados e valores a receber ou pagar. **Saída:**

- decisões do RII-007 e do RII-019 registradas no ADR-042;
- motor de cálculo exato de juros e parcelas;
- parcelamento de compra no cartão com prévia, memória de cálculo e projeção;
- antecipação, renegociação e reversão de parcelamentos;
- empréstimos a pagar e a receber com cronograma, eventos e saldo pendente;
- prova dos cálculos com propriedades, invariantes em PostgreSQL e mutação direcionada.

| História | Jira                                                             | PRs integrados à `main`                                                                                                                                                                                                   | Evidência principal                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisões | SESHAT-60 a SESHAT-63                                            | [#191](https://github.com/Pires3108/SeshatFinance/pull/191)                                                                                                                                                               | ADR-042; RII-007 com a matriz da Sprint 7; RII-019 decidido; INV-048 no catálogo.                                                                                                            |
| US-044   | [SESHAT-60](https://nicolaspires.atlassian.net/browse/SESHAT-60) | [#192](https://github.com/Pires3108/SeshatFinance/pull/192) (`ef15ea2`), [#194](https://github.com/Pires3108/SeshatFinance/pull/194) (`4e60cbc`), [#195](https://github.com/Pires3108/SeshatFinance/pull/195) (`396bfda`) | Cálculo exato com um único HALF_UP; plano idempotente que move a obrigação para uma parcela por ciclo; prévia RN-021 e faturas projetadas; Playwright 33,33/33,33/33,34.                     |
| US-045   | [SESHAT-61](https://nicolaspires.atlassian.net/browse/SESHAT-61) | #192, #194, [#197](https://github.com/Pires3108/SeshatFinance/pull/197) (`a45cce0`), [#199](https://github.com/Pires3108/SeshatFinance/pull/199) (`825ddda`)                                                              | Taxa mensal declarada; memória de cálculo versionada e exibida; nova versão auditável pela renegociação; 102,00/102,01 e 1,99% em 12 períodos.                                               |
| US-046   | [SESHAT-62](https://nicolaspires.atlassian.net/browse/SESHAT-62) | #199 (`825ddda`)                                                                                                                                                                                                          | Mudanças append-only do plano; antecipação na fatura aberta com desconto; renegociação com plano vinculado; reversão auditável; pagamento parcial pela quitação da S06.                      |
| US-047   | [SESHAT-63](https://nicolaspires.atlassian.net/browse/SESHAT-63) | [#196](https://github.com/Pires3108/SeshatFinance/pull/196) (`7ef9130`), [#198](https://github.com/Pires3108/SeshatFinance/pull/198) (`c3635e3`)                                                                          | Price, SAC e parcelas declaradas; datas efetivas com dia útil; alocação multa → juros → principal; excedente classificado; quitação, renegociação e reversão; página `/emprestimos`.         |
| US-048   | [SESHAT-64](https://nicolaspires.atlassian.net/browse/SESHAT-64) | [#200](https://github.com/Pires3108/SeshatFinance/pull/200) (`d0267f3`)                                                                                                                                                   | Propriedades fast-check; `s07-invariants` com SQL independente; 13 de 13 mutantes direcionados eliminados no CI; matriz `docs/quality/16-matriz-de-rastreabilidade-s07-parcelas-e-juros.md`. |

Cada PR foi integrado com o CI `quality` verde. O CI cobre formatação, build, lint, tipos, testes, Playwright, integração com PostgreSQL e a checagem de contrato OpenAPI. A partir do #200, cobre também a mutação direcionada.

**Decisões do titular do produto em 16/11/2026:**

- **Juros:** calculados em frações exatas, com um único arredondamento HALF_UP no total final, repartido pela RN-018.
- **Cartão:** o total da RN-020 é dividido em parcelas iguais.
- **Empréstimos:** perfis Price, SAC e parcelas declaradas.
- **Calendário:** os empréstimos reutilizam o calendário do RII-015.
- **Excedente:** recusado na fatura e classificado no empréstimo.
- **Taxa e multa:**
  - a taxa é um percentual mensal de 0 a 100, com até 6 casas;
  - a multa é aplicada uma única vez sobre a parcela vencida.
- **Parcelamento:** é feito sobre uma compra já registrada cuja fatura está aberta.
- **Juros como despesa:** os juros contam como despesa no ciclo da parcela.
- **Limite:** o limite fica ocupado pelo principal inteiro.

**Ajustes técnicos registrados no ADR-042:**

- **Juros por parcela:** seguem a fatia acumulada do total, para nenhum componente ficar negativo.
- **Price:** usa a forma fechada da amortização acumulada, limitada para nenhum componente ficar negativo. Os testes de propriedade encontraram o caso de 4,22 a 62% em 10x.
- **Obrigação elegível:** são as parcelas com vencimento efetivo até a data do pagamento.
- **Correção da renegociação:** a renegociação não é revertida; corrige-se renegociando de novo. A antecipação, por sua vez, tem reversão auditável.

**Limites rastreados:**

- não há conversão de taxa entre periodicidades nem juros de mora diários;
- a despesa de juros e o limite usado ainda não aparecem em nenhuma visão, porque nenhuma visão consolidada de despesas inclui compras de cartão (limite herdado da S06);
- a mutação direcionada usa um verificador próprio, e não o Stryker; a decisão pode ser revista quando a regeneração do lockfile voltar a ser confiável.

**Portão de encerramento:** SESHAT-60 a SESHAT-64 estão em Concluído, cada uma com comentário de evidência. Todos os PRs acima foram integrados com o CI `quality` verde. Este registro só é integrado depois do próprio CI verde. O estado do sprint no quadro do Jira não foi alterado. Nenhum deploy de produção faz parte deste encerramento.
