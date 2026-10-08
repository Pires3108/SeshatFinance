# US-004 — Evidência de gates do pull request

O workflow `.github/workflows/ci.yml` fixa Node em `.nvmrc` e pnpm em `packageManager`, instala com `--frozen-lockfile`, gera Prisma antes de compilar, verifica formatação, build, lint, tipos, unitários, bootstrap e integração PostgreSQL, e rejeita drift do OpenAPI e do cliente TypeScript.

`pnpm test:ci` verifica três falhas representativas com arquivos sintéticos temporários: campo público com tipo incompatível, asserção de teste quebrada e dependência ausente do lockfile. O teste do lockfile exige instalação imutável offline e confirma que o arquivo não foi reescrito. As fixtures são removidas após cada cenário; não alteram código ou dependências do projeto.

Os comandos de lint e tipos também verificam o novo teste. A formatação de três arquivos existentes de webhook foi normalizada e integrada à `main` pelo PR #141 para permitir que o gate global avance.

## Proteção de merge

RII-025 foi resolvida após decisão do responsável de tornar o repositório público. A proteção de `main` exige pull request e check `quality` verde com a base atualizada; aplica-se também a administradores. Force push e exclusão da branch estão desativados. O PR temporário #146 demonstrou o bloqueio real: mudou a versão de TypeScript no manifesto sem atualizar o lockfile, `quality` falhou e o GitHub retornou `mergeStateStatus=BLOCKED`; o PR foi fechado sem merge.

## Verificação reproduzível

Executar a sequência do workflow em checkout instalado com o lockfile imutável. Os resultados devem identificar o commit publicado. O evento assinado de CI é o sinal de conclusão assíncrona; não consultar repetidamente o provedor.

## Evidência publicada

Em 08/10/2026, o run de CI `37777398352` passou no commit `694fe15` do PR #130, baseado diretamente na `main`: instalação imutável dos 11 workspaces, geração Prisma, formatação, build, lint, tipos, testes unitários e os três cenários negativos, bootstrap real, integração PostgreSQL, OpenAPI e contrato de cliente. O commit final de documentação deve ter seu próprio CI verde antes do merge.

O cenário da asserção quebrada revelou que o teste filho herdava `NODE_TEST_CONTEXT` do runner Node e devolvia sucesso sem executar a fixture como teste independente. O processo filho agora limpa apenas essa variável; a mesma regressão reproduziu a falha antes da correção e passou depois dela.

Uma tentativa local anterior falhou ao acessar o cache do pnpm. O run publicado acima concluiu a verificação em checkout Ubuntu limpo; a prova de bloqueio de merge está no PR #146 e na configuração de proteção de `main`.
