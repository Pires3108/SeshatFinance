# ADR-042 — Parcelamento, juros e empréstimos declarados

**Status:** aceita para a Sprint 7 em 16/11/2026.

**Referências:** RF-035, RF-040 a RF-045; RN-018 a RN-021, RN-023; CA-009; INV-003 a INV-005, INV-017 a INV-019, INV-048; RII-007, RII-015, RII-019; ADR-035 a ADR-040; US-044 a US-048; SESHAT-60 a SESHAT-64.

## Contexto

Parcelamento no cartão, juros estimados e empréstimos alteram obrigação, saldo pendente e projeções. Em 30/09/2026 as histórias da Sprint 7 ficaram paradas porque o RII-007 não definia o arredondamento de juros e o RII-019 não definia calendário, amortização e excedente. As decisões do titular do produto de 28/09/2026 (alocação, antecipação, renegociação, correção) e de 16/11/2026 (arredondamento, perfis, calendário, excedente) fecham essas lacunas.

## Decisão

### Representação

- Valores monetários seguem `Money` (unidades mínimas em bigint e moeda explícita). Taxas são strings decimais de percentual por período, de 0 a 100 com até 6 casas, convertidas para racional exato (numerador e denominador bigint). Nenhum cálculo usa `number`.
- A taxa exige método (`simple` ou `compound`) e periodicidade. A periodicidade aceita é a do cronograma (mensal). Conversão entre periodicidades (taxa equivalente) não é inferida e fica fora do escopo.
- Quantidade de parcelas: 1 a 420.

### Arredondamento (RII-007)

- Juros e montante são calculados em racional exato, sem arredondar etapas intermediárias.
- Somente o total final é arredondado para a escala da moeda, com meio-para-cima (HALF_UP, afastando de zero no empate).
- O total é repartido pela regra RN-018: as parcelas anteriores truncam em direção a zero e a última recebe o resíduo.

### Parcelamento no cartão

- Juros simples: `juros = principal × taxa × n`. Compostos: `total = principal × (1 + taxa)^n`. Sem taxa, `total = principal`.
- `total` é dividido em `n` parcelas por RN-018. Os juros acumulados até a parcela `k` são `piso(juros × valor acumulado até k ÷ total)`, e a última parcela recebe o restante; o principal da parcela é o valor menos seus juros. Assim nenhum componente fica negativo e a soma das parcelas, dos principais e dos juros fecha exatamente (INV-005, INV-019).
- Exemplos de aceite: 100,00 BRL em 3x sem juros → 33,33 + 33,33 + 33,34. 100,00 BRL a 1% simples em 2 períodos → 2,00 de juros, total 102,00. 100,00 BRL a 1% composto em 2 períodos → total 102,01.
- Cada parcela pertence ao ciclo calculado pelo `CardCycleSchedule` (ADR-037), a partir do ciclo da compra. Só a parcela do ciclo corrente compõe a obrigação da fatura; as demais são compromissos projetados até seu ciclo.
- O cronograma e os parâmetros originais ficam congelados com `calculationVersion`. Mudança de parâmetro cria nova versão auditável; renegociação não reescreve o cronograma anterior.
- A fatura continua recusando excedente de quitação (ADR-040, decisão de 13/11/2026).
- **Parcelamento de compra registrada (decisão de 16/11/2026):** o plano parcela uma compra já registrada cuja fatura ainda está aberta. A compra continua sendo a despesa; ao confirmar, ela deixa de compor a própria fatura e cada parcela passa a compor a fatura do seu ciclo, a partir do ciclo da compra. O plano é recusado sem escrita quando alguma fatura de destino está fechada, quando a compra já tem plano ou quando as quitações já declaradas na fatura da compra superariam a nova obrigação dela (INV-018).
- **Juros como despesa (decisão de 16/11/2026):** o principal continua despesa na data da compra; os juros de cada parcela são despesa apenas no ciclo em que a parcela compõe a fatura. Enquanto nenhuma visão consolidada de despesas incluir compras de cartão (limite da Sprint 6), a regra fica registrada para essa visão.
- **Limite (decisão de 16/11/2026):** a compra parcelada ocupa o limite exibido pelo principal inteiro e o libera conforme as quitações; os juros só contam quando a parcela compõe a fatura. O limite continua organizacional e nunca bloqueia compra (INV-016).

### Empréstimos

- Direção: a pagar ou a receber. Contraparte opcional.
- Perfis de amortização:
  - **constante (Price):** `PMT = P·i·(1+i)^n / ((1+i)^n − 1)` em racional exato; total = HALF_UP(`n × PMT`), repartido por RN-018.
  - **decrescente (SAC):** amortizações = `P.split(n)`; juros de cada período = HALF_UP(`saldo devedor × i`); parcela = amortização + juros.
  - **crescente:** parcelas informadas pelo usuário; a soma deve fechar o total declarado, sem fórmula inferida.
  - Sem taxa, os três perfis equivalem a `P.split(n)`.
- No Price, os juros de cada parcela são HALF_UP(`saldo × i`) e a última parcela absorve a diferença para fechar o total.
- **Multa por atraso:** percentual declarado aplicado uma vez sobre a parcela vencida, com HALF_UP. É estimativa; o valor efetivo declarado prevalece sem apagar a estimativa.
- **Alocação de pagamento parcial (28/09/2026):** parcela vencida mais antiga primeiro; nela, multa → juros → principal. O usuário pode substituir a prioridade no evento.
- **Excedente:** exige classificação explícita, `extra-amortization` ou `receivable-credit`. Sem ela, o pagamento é recusado sem escrita.
- **Quitação antecipada:** registra valor e desconto declarados; as parcelas futuras continuam visíveis como quitadas e o cronograma original segue consultável.
- **Renegociação:** o contrato anterior fica como renegociado e um novo contrato é vinculado a ele.
- **Correção:** somente por reversão auditável seguida de novo registro. Saldo organizacional negativo é permitido.
- O saldo pendente é derivado do cronograma e dos eventos; cada evento o altera exatamente uma vez (INV-048).

### Calendário (RII-019)

- A regra geral reutiliza o RII-015 (ADR-037): dia configurado inexistente vale o último dia do mês; vencimento em fim de semana ou feriado do local do titular é postergado ao primeiro dia útil.
- Cada contrato ou parcela pode substituir a regra geral por "sem ajuste".
- O atraso começa no dia civil seguinte à data efetiva de vencimento, no fuso do titular.

### Escrita

- Toda criação e todo evento são comandos idempotentes conforme a ADR-035, com escopo de proprietário, auditoria append-only e transação única.
- Toda operação é declaração organizacional: nada envia ordem a emissor, credor ou devedor.

## Consequências

- O motor de cálculo vive em Domain, sem dependências, e é coberto por testes de propriedade e mutação (US-048).
- Conversão de taxa entre periodicidades, juros de mora diários e moedas além de BRL, USD e EUR continuam fora do escopo.
- Alterações no cálculo exigem nova `calculationVersion`; registros antigos mantêm o resultado da versão com que foram criados.
