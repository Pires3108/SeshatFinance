# ADR-034 — Fuso registrado por movimentação

**Status:** aceita para US-030 em 09/11/2026.

## Contexto

A RII-012 determina que, ao mudar de fuso, o titular escolha entre reinterpretar os itens existentes no novo fuso ou aplicar o novo fuso somente aos novos itens. Até então cada movimentação guardava apenas o instante em UTC (`occurred_at`), o que tornava a segunda opção impossível de representar.

## Decisão

`transactions.time_zone` guarda o fuso IANA usado para converter o instante daquela movimentação em data civil. A migração preenche as linhas existentes com o fuso atual do perfil do titular.

Um gatilho `BEFORE INSERT` atribui o fuso vigente do perfil a toda nova linha, com `America/Sao_Paulo` quando não há perfil. O gatilho cobre todas as origens de movimentação, inclusive transferências e ajustes, sem levar o fuso ao modelo de domínio. O bloqueio `FOR SHARE` sobre o perfil serializa a inserção com uma mudança de fuso concorrente, de modo que nenhuma linha fique para trás em uma reinterpretação.

A mudança de fuso é uma única transação com verificação da versão do perfil: atualiza o perfil, atualiza `time_zone` das movimentações do titular apenas na opção de reinterpretação e acrescenta um registro em `user_time_zone_changes`. Essa tabela é append-only e guarda fuso anterior, fuso novo, escopo, quantidade de linhas afetadas e instante. Repetir o pedido para o fuso já vigente não gera novo registro.

As visões temporais agrupam cada movimentação pelo próprio fuso. Instantes e valores nunca são alterados, e a versão da movimentação não muda, pois o fuso afeta apenas a apresentação civil.

## Consequências

- A consulta busca candidatos em uma janela ampliada em 24 horas de cada lado e descarta os que caem fora do período pela data civil de cada linha.
- `from` e `to` da resposta continuam descrevendo o período no fuso atual do perfil.
- Em uma mesma visão podem coexistir horários em fusos diferentes; a interface indica o fuso quando ele difere do atual.
- O registro de movimentações pela web ainda converte o horário informado pelo fuso do navegador. Esse comportamento é anterior e não faz parte desta decisão.
