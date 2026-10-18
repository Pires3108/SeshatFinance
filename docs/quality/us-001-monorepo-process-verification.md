# US-001 — Verificação dos processos do monorepo

Rastreabilidade: SESHAT-17, US-001, RNF-020/RNF-047 a RNF-054 e INV-001.

O CI instala os workspaces pelo lockfile, gera o cliente Prisma e compila todos
os packages e apps. Após o build, `pnpm test:health` executa API e worker
compilados e verifica liveness e encerramento. `pnpm test:web-process` inicia a
web compilada com `next start` em uma porta livre, verifica HTTP 200 e o
conteúdo público em pt-BR, encerra o processo e verifica que a porta deixa de
responder. A documentação da CLI Next instalada no projeto confirma que
`next start` serve o build de produção e aceita porta e hostname explícitos.

O teste web integra lint e `checkJs` estrito. A regra de arquitetura da US-002
verifica as fronteiras entre packages e impede acesso da web ao package de
banco, Domain e Application; a API permanece a fronteira de escrita financeira.
Essas verificações cobrem os três cenários BDD da US-001 sem usar dados reais
nem iniciar transações financeiras externas.
