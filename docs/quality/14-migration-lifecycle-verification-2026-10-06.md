# US-007 — Ciclo de migrations e seed sintético

## Escopo e rastreabilidade

US-007 / SESHAT-23; RNF-047 a RNF-050; INV-003 a INV-008. Incremento baseado na US-012 publicada, preservando o schema e os identificadores das quinze migrations existentes.

## Evidências dos critérios BDD

- Banco vazio: PostgreSQL 17 real recebeu todas as migrations via `prisma migrate deploy`. O teste compara a lista completa de migrations com os registros concluídos de `_prisma_migrations`.
- Seed repetido: duas execuções em banco vazio mantiveram exatamente um perfil sintético e nenhum registro em accounts, transactions, transfers ou credit_cards.
- Upgrade representativo: outro banco recebeu apenas as três primeiras migrations; nele foram inseridos conta e lançamento fictícios com quantidade inteira acima da precisão segura de JavaScript number. O upgrade aplicou todas as migrations restantes e preservou quantidade, moeda, owner e o novo campo nullable. Seed repetido não removeu os registros existentes. Uma escrita com owner incompatível foi rejeitada pela FK PostgreSQL (23503).
- Falha composta: a implementação do runner e a integração de transferências do incremento pai US-012 já verificaram rollback dos dois lados e auditoria, controle otimista e idempotência concorrente (cinco testes reais). Nenhuma dessas fontes foi alterada por US-007; o incremento acrescenta a verificação do ciclo das migrations e a proteção do seed.
- Produção: `assertSyntheticSeedTarget` recusa NODE_ENV=production ou host remoto antes da construção do cliente. Três regressões cobrem produção, URL ausente/protocolo inválido, destino remoto e destinos loopback de teste.

## Resultados e ambiente

`migration-lifecycle.integration.spec.ts`: um teste passou em 71,59 segundos com dois bancos no mesmo PostgreSQL 17 temporário. A primeira inicialização não ficou saudável dentro de 120 segundos; com prazo de startup de 180 segundos, a repetição passou. Não se reiniciou o Docker, que já estava disponível (28.3.3).

Tipos e lint de Database passaram; sete testes unitários passaram; cliente Prisma foi gerado com configuração explícita. O teste utiliza migrations versionadas, duas execuções reais do seed por banco e queries parametrizadas com dados exclusivamente fictícios. A fixture temporária só é removida após validar que seu caminho pertence ao diretório criado pelo teste.

## Recuperação e implantação

Sem migration nova, mudança de schema, contrato HTTP, dependência ou implantação. Antes de aplicar migrations em produção, preserve backup consistente e verifique a restauração em ambiente isolado. Em caso de falha destrutiva, restaure o backup para uma instância separada e aplique um incremento corretivo revisado; não reescreva migrations publicadas nem execute rollback SQL improvisado. O seed de demonstração não é um procedimento de inicialização de produção.
