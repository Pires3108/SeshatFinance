# US-006 — Verificação da saúde dos processos

Rastreabilidade: SESHAT-22, US-006, RNF-013/RNF-019/RNF-032 e INV-042.

`pnpm build` seguido de `pnpm test:health` executa os entrypoints compilados
da API e do worker em processos filhos reais. A API expõe
`GET /api/v1/health`; o worker expõe `GET /health`. Ambos respondem sem
autenticação com HTTP 200 e somente `service` e `status: "ok"`.

Os quatro casos verificam cada serviço vivo e depois encerrado por SIGTERM
ou SIGKILL. Depois de observar a saída do processo, a consulta deve falhar,
sem receber resposta saudável. Em Windows, os sinais encerram o processo;
no CI Linux, SIGTERM também exercita os hooks de desligamento da aplicação.

As dependências externas apontam para um endereço local indisponível durante
o smoke, provando que liveness permanece independente de falhas transitórias.
A readiness da API continua separada em `/api/v1/health/ready`; o smoke exige
HTTP 503 com banco indisponível e confirma novamente HTTP 200 na liveness.
Os testes existentes também verificam indisponibilidade e timeout.
A história não exige readiness do worker.

Uma sentinela sintética na configuração permite detectar divulgação de segredo
nos logs de início e encerramento. O contrato exato impede a inclusão de dados
financeiros no corpo. Nenhum dado financeiro real é utilizado e nenhuma
transação externa é executada.

O comando faz parte do job de qualidade do CI imediatamente após o build.
O script participa do lint e da verificação de tipos com `checkJs` estrito,
incluindo tipos explícitos dos sinais de encerramento.
