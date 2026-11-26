# Sprint 8 — Evidência de encerramento

**Data:** 26/11/2026. **Objetivo do roadmap:** acompanhar metas, reservas e orçamentos sem tratar planejamento como dinheiro novo. **Saída:**

- decisões do RII-018 registradas no ADR-043 e no adendo de orçamentos;
- metas livres ou vinculadas a contas, com fatias, prazo no fuso do perfil e painel de impacto;
- reserva por conta separando saldo contábil, reserva e disponível;
- distribuição de entradas entre metas, com progresso que não conta duas vezes;
- orçamentos mensais por categoria, centro de custo ou conta, com excedente só como aviso;
- prova das invariantes com propriedades, suíte em PostgreSQL e mutação direcionada.

| História | Jira                                                             | PRs integrados à `main`                                                 | Evidência principal                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisões | SESHAT-65 a SESHAT-69                                            | [#202](https://github.com/Pires3108/SeshatFinance/pull/202) (`406f0a6`) | ADR-043; RN-068 a RN-071; INV-047 no catálogo; RF-048 e CA-013 com "receita ou transferência recebida"; RII-018 decidido.                                                                                         |
| US-049   | [SESHAT-65](https://nicolaspires.atlassian.net/browse/SESHAT-65) | [#203](https://github.com/Pires3108/SeshatFinance/pull/203) (`88afa1a`) | Metas com alvo, prazo e fatias de conta limitadas ao saldo sob trava; situação no fuso do perfil; conversão só de apresentação; painel de impacto antes de arquivar ou mandar a conta para a lixeira.             |
| US-051   | [SESHAT-67](https://nicolaspires.atlassian.net/browse/SESHAT-67) | [#204](https://github.com/Pires3108/SeshatFinance/pull/204) (`b2fb55d`) | Reserva versionada e auditada; recusa acima do saldo na declaração; aviso "reserva acima do saldo" depois; resumo por moeda sem somar moedas; Playwright dos 3 cenários.                                          |
| US-050   | [SESHAT-66](https://nicolaspires.atlassian.net/browse/SESHAT-66) | [#205](https://github.com/Pires3108/SeshatFinance/pull/205) (`669af1d`) | Distribuição de receita ou entrada de transferência entre metas sob trava da entrada; recusa integral do excesso; lixeira conta zero e mantém o vínculo; entrada em conta vinculada não soma de novo.             |
| US-052   | [SESHAT-68](https://nicolaspires.atlassian.net/browse/SESHAT-68) | [#206](https://github.com/Pires3108/SeshatFinance/pull/206)             | Orçamento mensal por dimensão com versões de limite; realizado pela visão temporal pública, no mês civil do perfil; reembolso vinculado descontado; transferência, ajuste e fatura fora; excedente só como aviso. |
| US-053   | [SESHAT-69](https://nicolaspires.atlassian.net/browse/SESHAT-69) | [#207](https://github.com/Pires3108/SeshatFinance/pull/207)             | Propriedades fast-check; `s08-invariants` com SQL independente; 9 de 9 mutantes da S08 eliminados (22 de 22 no total); matriz `docs/quality/17-matriz-de-rastreabilidade-s08-metas-e-orcamentos.md`.              |

Cada PR foi integrado com o CI `quality` verde. O CI cobre formatação, build, lint, tipos, testes, Playwright, integração com PostgreSQL, a checagem de contrato OpenAPI e a mutação direcionada. Os PRs #205 a #207 foram empilhados para não repetir a instalação de dependências, que é lenta na máquina local. Cada um foi atualizado com a `main` e passou no CI antes de ser integrado.

**Decisões do titular do produto em 17/11/2026:**

- **Fontes de contribuição:** receitas e o lado de entrada das transferências.
- **Contas vinculadas:** uma conta pode estar em várias metas, cada uma com uma fatia, e a soma das fatias não passa do saldo.
- **Situação da meta:** calculada automaticamente no fuso do perfil.
- **Reserva acima do saldo:** quando o saldo cai depois, a reserva é mantida e aparece um aviso.

**Decisões aplicadas pelo plano (adendo do ADR-043, 26/11/2026):** o titular pediu para seguir o plano até o fim da sprint. Por isso, as duas perguntas da US-052 foram respondidas com a proposta do plano:

- **Compras de cartão:** ficam fora do realizado até existir a visão consolidada de despesas.
- **Sobreposição:** não pode haver dois orçamentos ativos para a mesma dimensão e moeda.

O titular pode revisar as duas no ADR.

**Ajustes técnicos registrados no ADR-043:**

- **Reserva:** remover é gravar zero, preservando versão e histórico.
  - Só uma conta ativa aceita mudança de reserva.
  - Uma conta na lixeira sai do resumo e volta ao ser restaurada.
- **Contribuição:**
  - entradas de reembolso, ajustes de saldo e pagamentos de fatura não são elegíveis;
  - uma entrada editada abaixo da soma das linhas conta de forma proporcional.
- **Orçamento:**
  - o realizado vem do `ListTemporalTransactionsUseCase`, que passou a indicar transferência, ajuste e reembolso;
  - no orçamento por categoria, conta também a subcategoria do lançamento.

**Limites rastreados:**

- **Troca de moeda de conta:** não existe hoje, então o painel de impacto das metas cobre só arquivar e mandar para a lixeira.
- **Rotina de contribuição:** a rotina opcional depende da semântica de recorrência do RII-020.
- **Outra moeda no orçamento:** despesas em moeda diferente da do orçamento não são convertidas e aparecem só como contagem.
- **Compras de cartão:** seguem fora de qualquer visão consolidada de despesas, limite herdado da S06.
- **Reembolsos no orçamento:** só reduzem o realizado do mês em que foram registrados, quando a despesa original é do mesmo mês.
- **Playwright local:** as jornadas da S08 rodaram só no CI, porque a máquina local interrompe a suíte por falta de memória.

**Portão de encerramento:** SESHAT-65 a SESHAT-69 estão em Concluído, cada uma com comentário de evidência. Todos os PRs acima foram integrados com o CI `quality` verde. Este registro só é integrado depois do próprio CI verde. O estado do sprint no quadro do Jira não foi alterado. Nenhum deploy de produção faz parte deste encerramento.
