# US-004 — Evidência de gates do pull request

O workflow `.github/workflows/ci.yml` fixa Node em `.nvmrc` e pnpm em `packageManager`, instala com `--frozen-lockfile`, gera Prisma antes de compilar, verifica formatação, build, lint, tipos, unitários, bootstrap e integração PostgreSQL, e rejeita drift do OpenAPI e do cliente TypeScript.

`pnpm test:ci` verifica três falhas representativas com arquivos sintéticos temporários: campo público com tipo incompatível, asserção de teste quebrada e dependência ausente do lockfile. O teste do lockfile exige instalação imutável offline e confirma que o arquivo não foi reescrito. As fixtures são removidas após cada cenário; não alteram código ou dependências do projeto.

Os comandos de lint e tipos também verificam o novo teste. A formatação de três arquivos existentes de webhook foi normalizada e integrada à `main` pelo PR #141 para permitir que o gate global avance.

## Critério pendente

RII-025 registra a indisponibilidade de proteção de branch no plano atual do repositório privado. O workflow produz falha no PR, mas a exigência de impedir merge aguarda decisão e configuração verificável. Um resultado local ou CI verde não encerra essa pendência.

## Verificação reproduzível

Executar a sequência do workflow em checkout instalado com o lockfile imutável. Os resultados devem identificar o commit publicado. O evento assinado de CI é o sinal de conclusão assíncrona; não consultar repetidamente o provedor.

## Evidência publicada

Em 06/10/2026, o run de CI `37500848665` passou no commit `1b186563`: instalação imutável dos 11 workspaces, geração Prisma, formatação, build, lint, tipos, testes unitários e os três cenários negativos, bootstrap real, integração PostgreSQL, OpenAPI e contrato de cliente. Essa evidência é anterior à integração das demais histórias da Sprint 0. O PR #130 agora tem `main` como base direta; seu head atualizado precisa de um novo run completo de CI antes da revisão final.

O cenário da asserção quebrada revelou que o teste filho herdava `NODE_TEST_CONTEXT` do runner Node e devolvia sucesso sem executar a fixture como teste independente. O processo filho agora limpa apenas essa variável; a mesma regressão reproduziu a falha antes da correção e passou depois dela.

Uma tentativa local anterior falhou ao acessar o cache do pnpm. O run publicado acima concluiu a verificação em checkout Ubuntu limpo; não representa prova de proteção obrigatória da branch, que segue em RII-025.
