# Sprint 6 — Evidência de encerramento

**Data:** 13/11/2026. **Objetivo do roadmap:** registrar compras e obrigações sem dupla contabilização. **Saída:**

- cadastro de cartão com ciclo determinístico e calendário de feriados versionado;
- compra reconhecida uma vez;
- formação e fechamento manual de fatura;
- quitação declarada sem segunda despesa;
- estados de atenção e atraso;
- invariantes INV-014 a INV-018 automatizados com a jornada de compra até quitação.

| História | Jira                                                             | PR integrado à `main`                                                   | Evidência principal                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-038   | [SESHAT-54](https://nicolaspires.atlassian.net/browse/SESHAT-54) | [#184](https://github.com/Pires3108/SeshatFinance/pull/184) (`58dedb6`) | Ciclo RII-015 (ADR-037): mês curto, vencimento no mês seguinte, opção de compra no fechamento, dia útil com feriados nacionais, Carnaval, 31/12, das 27 UFs e das 27 capitais (dataset com fonte por entrada) e feriados declarados; edição auditada com versão; [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43481454636/job/132078697450). |
| US-039   | [SESHAT-55](https://nicolaspires.atlassian.net/browse/SESHAT-55) | [#185](https://github.com/Pires3108/SeshatFinance/pull/185) (`491fb7d`) | Compra como fato próprio (ADR-038), ciclo fixado no registro, idempotência ADR-035, moeda diferente 422; [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43492183364/job/132115931168).                                                                                                                                                         |
| US-040   | [SESHAT-56](https://nicolaspires.atlassian.net/browse/SESHAT-56) | [#186](https://github.com/Pires3108/SeshatFinance/pull/186) (`db45b68`) | Fatura por ciclo com datas e regra congeladas, roteamento sob bloqueio, compra após fechamento na próxima fatura aberta, fechamento manual idempotente e imutável (ADR-039); [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43500058261/job/132143166487).                                                                                     |
| US-041   | [SESHAT-57](https://nicolaspires.atlassian.net/browse/SESHAT-57) | [#187](https://github.com/Pires3108/SeshatFinance/pull/187) (`e1a345a`) | Quitação declarada com movimentação congelada, sem despesa nas visões, excedente 422, concorrência sob bloqueio (ADR-040); [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43505220834/job/132160991629).                                                                                                                                       |
| US-042   | [SESHAT-58](https://nicolaspires.atlassian.net/browse/SESHAT-58) | [#188](https://github.com/Pires3108/SeshatFinance/pull/188) (`3976a6f`) | Estados derivados no servidor com antecedência de 5 dias configurável por cartão e rótulos textuais (ADR-041); [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43510787247/job/132180176585).                                                                                                                                                   |
| US-043   | [SESHAT-59](https://nicolaspires.atlassian.net/browse/SESHAT-59) | [#189](https://github.com/Pires3108/SeshatFinance/pull/189) (`a6d6126`) | Suíte `s06-invariants.integration.spec.ts` com recálculo SQL independente após cada passo, jornada Playwright de compra até quitação e matriz de rastreabilidade; [CI `quality`](https://github.com/Pires3108/SeshatFinance/actions/runs/43519525404/job/132209997925).                                                                                                |

**Decisões do titular do produto em 13/11/2026:**

- feriados nacionais, das UFs e das capitais com fonte citada, mais Carnaval e 31/12 bancários;
- o fechamento é tratado como data civil;
- compra em outra moeda é recusada;
- compra após o fechamento vai para a próxima fatura aberta;
- excedente de pagamento é recusado;
- a antecedência de atenção é de 5 dias;
- histórias da S06 vão para Concluído após integração com CI verde, sem deploy de produção.

**Limites rastreados:**

- feriados AL 30/11, PE 24/06 e transferências do Acre aguardam fonte;
- municípios fora das capitais dependem de feriados declarados;
- conversão de moeda;
- visão consolidada de despesas com compras de cartão;
- edição, estorno e lixeira de compras;
- reversão de quitação;
- tratamento do excedente;
- notificação da data prevista de fechamento.

**Portão de encerramento:** cada PR foi integrado após CI `quality` verde; este registro só é integrado após o próprio CI verde. Todas as histórias de SESHAT-54 a SESHAT-59 estão em Concluído, cada uma com comentário de evidência. Nenhum deploy de produção faz parte deste encerramento.
