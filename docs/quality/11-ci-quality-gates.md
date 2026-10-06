# US-004 — Evidência de gates do pull request

O workflow `.github/workflows/ci.yml` fixa Node em `.nvmrc` e pnpm em `packageManager`, instala com `--frozen-lockfile`, gera Prisma antes de compilar, verifica formatação, build, lint, tipos, unitários, bootstrap e integração PostgreSQL, e rejeita drift do OpenAPI e do cliente TypeScript.

`pnpm test:ci` verifica três falhas representativas com arquivos sintéticos temporários: campo público com tipo incompatível, asserção de teste quebrada e dependência ausente do lockfile. O teste do lockfile exige instalação imutável offline e confirma que o arquivo não foi reescrito. As fixtures são removidas após cada cenário; não alteram código ou dependências do projeto.

Os comandos de lint e tipos também verificam o novo teste. A formatação de três arquivos existentes de webhook foi normalizada para permitir que o gate global avance.

## Critério pendente

RII-025 registra a indisponibilidade de proteção de branch no plano atual do repositório privado. O workflow produz falha no PR, mas a exigência de impedir merge aguarda decisão e configuração verificável. Um resultado local ou CI verde não encerra essa pendência.

## Verificação reproduzível

Executar a sequência do workflow em checkout instalado com o lockfile imutável. Os resultados devem identificar o commit publicado. O evento assinado de CI é o sinal de conclusão assíncrona; não consultar repetidamente o provedor.

## Evidência local inicial

Em 06/10/2026, Node 22.17.1 e pnpm 11.22.0 foram confirmados. O check global do Prettier e os três testes do guard de webhooks passaram. Os três cenários negativos passaram usando uma cópia temporária do teste atual e o TypeScript 5.9.3 já instalado em outro checkout. Essa execução antecipada não substitui a instalação imutável e os gates no checkout deste PR.

O cenário da asserção quebrada revelou que o teste filho herdava `NODE_TEST_CONTEXT` do runner Node e devolvia sucesso sem executar a fixture como teste independente. O processo filho agora limpa apenas essa variável; a mesma regressão reproduziu a falha antes da correção e passou depois dela.

A primeira instalação imutável terminou com erro `ERR_PNPM_UNKNOWN` ao acessar o cache local do pnpm. A nova tentativa usa cache separado e permanece em execução. Build, lint, tipos, unitários, integração e contratos globais ainda não são declarados aprovados nesta evidência inicial.
