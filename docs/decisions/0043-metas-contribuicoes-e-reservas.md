# ADR-043 — Metas, contribuições e reservas declaradas

**Status:** aceita para a Sprint 8 em 17/11/2026.

**Referências:** RF-047 a RF-050; RN-031 a RN-033, RN-068 a RN-071; CA-013; INV-006, INV-012, INV-013, INV-025, INV-026, INV-029, INV-047; RII-012, RII-017, RII-018; ADR-034, ADR-035; US-049 a US-053; SESHAT-65 a SESHAT-69.

## Contexto

O RII-018 impedia persistir metas, contribuições, progresso e reservas. Os requisitos não definiam quais movimentações alimentam uma meta, se uma conta pode servir a várias metas, como o prazo vira situação e o que acontece quando o saldo cai abaixo de uma reserva. Inferir essas regras poderia contar o mesmo valor duas vezes, mostrar progresso em moeda incompatível ou marcar uma meta como atrasada no dia errado. As decisões do titular do produto de 17/11/2026 fecham essas lacunas.

## Decisão

### Meta

- Uma meta tem nome, alvo `Money` com moeda explícita, valor inicial opcional na mesma moeda, prazo opcional e estado. O modo é **livre** (só contribuições) ou **vinculado** (uma ou mais contas, com ou sem contribuições).
- Criar, editar, pausar ou arquivar uma meta nunca cria lançamento nem altera saldo ou patrimônio (RN-033, INV-026).
- O prazo é uma data civil interpretada no fuso IANA do perfil, como as demais visões temporais (RII-012).

### Contas vinculadas (RN-069)

- Uma conta pode estar vinculada a várias metas. Cada vínculo declara uma **fatia**: um valor `Money` na moeda da conta ou o saldo inteiro (100%).
- A soma das fatias de uma conta não pode passar do saldo contábil da conta no momento da declaração. Uma fatia de 100% é exclusiva: a conta não aceita outro vínculo enquanto ela existir.
- Se o saldo cair depois abaixo da soma das fatias, cada fatia de valor conta pelo menor entre o valor declarado e a sua parte proporcional do saldo atual, e a meta mostra o aviso "saldo da conta abaixo das fatias declaradas". Nenhum vínculo é alterado automaticamente.
- Mudança de moeda ou de ciclo de vida de uma conta vinculada exige mostrar o impacto em cada meta e uma escolha explícita para cada uma (manter, desvincular ou arquivar a meta).

### Contribuições (RN-068)

- Origens elegíveis: receitas efetivadas e o lado de entrada de transferências efetivadas, ambos do próprio titular. Ajustes de saldo, reembolsos e lançamentos projetados não são elegíveis.
- O valor elegível é o valor da movimentação, deduzidos reembolsos e estornos vinculados ativos ou arquivados.
- Uma origem pode ser dividida entre várias metas. A soma das alocações ativas não supera o valor elegível (RN-032, INV-025). Uma tentativa acima do limite é recusada integralmente, sem alocação parcial.
- A alocação é gravada com origem, meta, valor, moeda e autor, na mesma transação da auditoria, com bloqueio por origem e `Idempotency-Key` (ADR-035).
- Arquivamento, lixeira, estorno ou reversão da origem recalculam o progresso; o vínculo histórico permanece consultável.
- **Sem dupla contagem:** uma contribuição cuja conta de destino está vinculada à mesma meta não soma de novo; o valor já está na fatia da conta.

### Progresso e situação (RN-070)

- O progresso é a soma do valor inicial, das contribuições efetivas e das fatias de contas vinculadas. A projeção da rotina de contribuição é exibida separadamente e nunca soma ao progresso.
- Valores em moeda diferente da meta são convertidos apenas para apresentação, com a cotação manual vigente (US-022), mostrando taxa, fonte e instante. Sem cotação válida, o valor convertido e o progresso total ficam **indisponíveis**, nunca zero; o valor original continua visível (INV-047).
- A situação é calculada, e não armazenada:
  - **concluída** quando o progresso é maior ou igual ao alvo;
  - **atrasada** a partir do dia civil seguinte ao prazo, se o progresso continuar abaixo do alvo;
  - **em andamento** nos demais casos, inclusive sem prazo;
  - **indeterminada** quando o progresso está indisponível por falta de cotação;
  - **pausada** e **arquivada** são estados escolhidos pelo usuário e prevalecem sobre o cálculo.
- A situação usa relógio e fuso injetados. Rótulos não dependem apenas de cor.

### Reserva (RN-071)

- A reserva é uma declaração organizacional sobre uma conta: um valor `Money` na moeda da conta. O saldo contábil não muda.
- Disponível = saldo contábil − reserva, na mesma moeda. O patrimônio inclui o saldo contábil uma única vez, com ou sem reserva (RN-031, INV-012, INV-013).
- Criar ou aumentar uma reserva acima do saldo contábil no momento da declaração é recusado sem efeito parcial.
- Se o saldo cair depois abaixo da reserva, a reserva declarada fica como está, o disponível pode ficar negativo e a interface mostra "reserva acima do saldo". Nada é ajustado automaticamente.
- Reserva e meta são conceitos independentes: o tipo de conta "reserva" não vincula a conta a nenhuma meta, e reservar não gera transferência.
- Mudanças de reserva são versionadas e auditadas, com `Idempotency-Key`.

### Orçamentos

As regras de orçamento (US-052) seguem pendentes de confirmação no início da história: inclusão de compras de cartão no realizado e sobreposição de orçamentos na mesma dimensão. A proposta é calcular o realizado com as despesas efetivadas no intervalo `[início, próximo início)` no fuso do perfil, deixar compras de cartão fora até existir a visão consolidada de despesas, e recusar dois orçamentos para a mesma dimensão, moeda e período. A confirmação será registrada como adendo deste ADR.

## Consequências

- Metas e reservas podem ser persistidas; o RII-018 passa a decidido.
- Progresso e disponível são leituras derivadas; nenhuma tabela de saldo é reescrita.
- A fatia limitada ao saldo atual evita dupla contagem quando várias metas compartilham uma conta, ao custo de um aviso extra na interface.
- A conversão continua só de apresentação; consolidação contábil em BRL segue dependente do RII-007.
- **Limites da US-049:** a moeda de uma conta não pode ser alterada hoje, então o painel de impacto cobre o arquivamento e a lixeira da conta; se a troca de moeda for criada, ela deve reutilizar o mesmo painel. A rotina opcional de contribuição depende da semântica de recorrência ainda aberta no RII-020 e não foi implementada. Saldo negativo conta zero para a meta, e uma conta na lixeira deixa de contar até ser restaurada.

## Alternativas consideradas

- **Só transferências como origem** (texto literal de RF-048 e CA-013): descartada, porque obrigaria o usuário a registrar uma transferência fictícia para destinar parte de uma receita.
- **Conta exclusiva por meta:** descartada, porque impede dividir uma conta de investimento entre objetivos.
- **Saldo inteiro em várias metas:** descartada, porque conta o mesmo dinheiro duas vezes.
- **Conclusão declarada pelo usuário:** descartada em favor do cálculo automático; o usuário continua podendo pausar ou arquivar.
- **Reserva efetiva limitada ao saldo:** descartada, porque esconderia a reserva declarada; o aviso explicita a situação.

## Referências e rastreabilidade

Decisões registradas nas histórias SESHAT-65 a SESHAT-69. A verificação fica na US-053, com a matriz de rastreabilidade da Sprint 8.
