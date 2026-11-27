# ADR-044 — Investimentos manuais: posição, eventos e consolidação

**Status:** aceita para a Sprint 9 em 26/11/2026.

**Referências:** RF-051 a RF-055; RN-034 a RN-037, RN-072 a RN-075; CA-014; INV-027 a INV-029, INV-049; RII-007, RII-016, RII-017; ADR-034, ADR-035, ADR-036, ADR-042, ADR-043; US-054 a US-058.

## Contexto

O RII-016 impedia persistir posições de investimento. Os requisitos não definiam unidade e escala da quantidade, precisão do preço unitário, a diferença entre taxa contratada e taxa paga, nem como um aporte declarado se relaciona com o saldo da conta. Também não definiam como somar em BRL uma posição em moeda estrangeira. Inferir essas regras poderia perder precisão no custo, tratar um percentual como dinheiro ou contar o mesmo valor duas vezes no patrimônio. As decisões do titular do produto de 26/11/2026 fecham essas lacunas.

A Seshat Finance só registra. Nenhum aporte, resgate ou evento é executado em corretora, banco ou qualquer serviço externo.

## Decisão

### Investimento (RF-051, RF-052)

- Um investimento é uma entidade própria do titular, separada das contas. Ele tem:
  - tipo do catálogo de onze tipos;
  - instituição, nome do ativo e código opcional;
  - moeda explícita;
  - data inicial e vencimento opcional;
  - indexador e taxa contratada opcionais;
  - liquidez;
  - ciclo de vida ativo, arquivado ou na lixeira.
- A **taxa contratada** é descritiva. Ela tem um indexador (`cdi`, `selic`, `ipca`, `prefixed`, `other`) e um percentual em decimal textual, por exemplo `110` (110% do CDI) ou `6.5` (IPCA + 6,5%). Ela não entra em nenhum cálculo de posição, custo ou valor.
- A **liquidez** é `daily`, `at-maturity` ou `d-plus`, com um número de dias úteis de 0 a 3650.
- Criar, editar ou arquivar um investimento não cria lançamento e não altera saldo nem patrimônio.

### Quantidade e preço (RN-072)

- A quantidade é um decimal textual não negativo, com escala máxima por tipo:

| Tipo                                 | Casas da quantidade |
| ------------------------------------ | ------------------- |
| `stock`, `fii`, `etf`                | 0                   |
| `cryptocurrency`                     | 8                   |
| `investment-fund`, `private-pension` | 6                   |
| `treasury-direct`                    | 2                   |
| `cdb`, `lci`, `lca`, `savings`       | sem quantidade      |

- Nos tipos sem quantidade, a posição é acompanhada só pelo valor.
- O preço unitário é um decimal textual positivo, com até 8 casas, na moeda do investimento. Ele não é `Money` nem `number`.
- Custo, valor e resultados são calculados em racional exato. Só o resultado final é arredondado para a escala da moeda, com meio-para-cima (HALF_UP), a mesma regra do ADR-042. Nenhum preço médio arredondado é gravado.

### Eventos (RF-053, RN-035, RN-073)

- Os eventos são aporte, resgate, rendimento, dividendo, juros, taxa e imposto. Cada um tem:
  - valor `Money` positivo na moeda do investimento;
  - data civil e fuso IANA (ADR-034);
  - quantidade, só em aporte e resgate de tipos com quantidade.
- **Aporte e resgate com conta:** na mesma transação, gravam o evento e uma transferência interna entre a conta e o investimento. A transferência reduz (aporte) ou aumenta (resgate) o saldo contábil da conta. O comando usa `Idempotency-Key` e auditoria em cadeia (ADR-035, ADR-036).
- **Aporte sem conta:** representa uma posição que já existia antes do registro. Não altera saldo de conta.
- A conta precisa estar ativa e ter a mesma moeda do investimento. Sem isso, o comando é recusado sem efeito parcial.
- **Rendimento, dividendo e juros:** com conta de destino, geram uma receita vinculada nessa conta. Sem conta, valem como renda reinvestida no próprio investimento.
- **Taxa e imposto:** são valores monetários pagos, separados da taxa contratada. Eles reduzem o resultado e não alteram a quantidade.
- Um resgate acima da quantidade em custódia é recusado sem efeito parcial.
- Um evento editado ou mandado para a lixeira leva junto a transferência ou receita vinculada. Um evento na lixeira deixa de contar e volta a contar ao ser restaurado.

### Valor atual informado (RN-034, RN-074)

- O valor atual é declarado pelo usuário como `Money` na moeda do investimento, com data de referência. Ele é versionado e auditado, como a reserva do ADR-043.
- Repetir o mesmo valor com a mesma chave não cria versão nova.
- O **valor atual efetivo** é o último valor informado mais os fluxos com data posterior à data de referência dele. Os fluxos são os aportes e a renda reinvestida, menos os resgates. Antes do primeiro valor informado, a base é zero e contam todos os fluxos desde a data inicial.
- Assim, um aporte ou um resgate sozinho nunca muda o patrimônio (INV-027). Só um novo valor informado mostra ganho ou perda.
- Taxas e impostos lançados depois do último valor informado não mudam o valor efetivo. Eles aparecem nos custos pagos e o próximo valor informado já os reflete.
- A leitura indica se o valor efetivo veio de um valor informado ou só dos fluxos ("valor atual não informado").

### Indicadores (RF-054, INV-028)

- **Quantidade em custódia:** soma das quantidades de aportes menos as de resgates.
- **Custo:** custo médio ponderado. Um aporte soma o seu valor ao custo. Um resgate tira do custo a parte proporcional da quantidade resgatada; nos tipos sem quantidade, a parte proporcional ao valor resgatado sobre o custo, limitada a zero.
- **Renda recebida:** soma de rendimentos, dividendos e juros.
- **Custos pagos:** soma de taxas e impostos.
- **Resultado nominal:** valor atual efetivo + resgates + renda recebida com conta − aportes − custos pagos. A renda reinvestida já está no valor efetivo e não é somada de novo.
- **Rentabilidade percentual:** resultado nominal ÷ aportes, em decimal textual com 4 casas (HALF_UP). Fica indisponível quando não há aporte.
- **Tempo de aplicação:** dias civis entre a data inicial e hoje, no fuso do perfil, com relógio injetado.
- Custo, valor atual e renda são sempre grandezas separadas na leitura e na interface.

### Consolidação (RF-055, RN-037, RN-075)

- O saldo investido é a soma dos valores atuais efetivos dos investimentos ativos e arquivados. Os investimentos na lixeira ficam fora.
- O patrimônio é o saldo contábil das contas mais o saldo investido. Ele conta o saldo uma única vez, como na reserva (ADR-043). Um aporte com conta não muda o patrimônio: a conta cai e o valor efetivo do investimento sobe na mesma quantia.
- A consolidação em BRL usa a cotação manual vigente na data de referência (US-022). A leitura guarda o valor original, a moeda, a taxa, a origem e a data da cotação. A conversão é só de apresentação e nunca altera o valor gravado.
- Uma posição ou um saldo de conta em moeda estrangeira sem cotação vigente aparece à parte, como "sem conversão", com o valor original. Ele não entra no total em BRL e não conta como zero (INV-049).

## Consequências

- Investimentos, eventos e valor atual podem ser persistidos. O RII-016 passa a decidido.
- Posição, custo e rentabilidade são leituras derivadas. Nenhuma tabela de saldo é reescrita.
- A transferência vinculada mantém o saldo contábil das contas correto sem um tipo de conta "investimento".
- **Limite: a consolidação em BRL segue o RII-007 só para apresentação.** A conversão de saldos de conta para um patrimônio único em BRL vale apenas na leitura consolidada desta sprint.
- **Limite: atualização automática.** Cotações, proveniência e atualização automática ficam para o pós-MVP (RF-056, RN-036).

## Alternativas consideradas

- **Tudo em centavos, sem quantidade nem preço médio:** descartada, porque não atende o RF-052 e perde precisão no custo.
- **Investimento como tipo de conta:** descartada, porque mistura o saldo contábil com o valor atual informado.
- **Só eventos monetários, sem taxa contratada:** descartada, porque o RF-052 pede indexador e taxa como dados do investimento.
- **Sem consolidação em BRL:** descartada, porque o RF-055 pede o saldo investido dentro do patrimônio.

## Referências e rastreabilidade

Decisões tomadas pelo titular do produto em 26/11/2026, ao planejar a Sprint 9. A verificação fica na US-058, com a matriz de rastreabilidade da Sprint 9.
