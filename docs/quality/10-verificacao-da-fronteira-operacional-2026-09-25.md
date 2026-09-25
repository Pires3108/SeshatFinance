# Seshat Finance — verificação da fronteira operacional em 25/09/2026

## Escopo

`tools/verify-operational-boundary.mjs` é executado pelo script raiz `pnpm test` e, por consequência, pela CI. Ele impede imports ou dependências de provedores de pagamento conhecidos e nomes de operações que iniciem, autorizem, capturem, agendem ou cancelem pagamentos.

Essa checagem protege INV-001 e INV-002 contra introduções acidentais de capacidade operacional externa. O teste de regressão inclui exemplos internos permitidos e exemplos proibidos de dependência e operação.

## Limite deliberado

O guard é uma proteção de política baseada em código e dependências, não uma prova semântica completa. Uma integração futura somente de leitura deve passar por revisão de arquitetura e ampliar este guard e seus testes antes de ser adicionada. Integrações com capacidade de escrita financeira externa permanecem incompatíveis com RN-001 e devem falhar na revisão.
