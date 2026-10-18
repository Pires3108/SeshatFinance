# ADR-033 — Origem confiável dos limites de autenticação

**Status:** aceita para US-018 em 13/10/2026.

## Decisão

A API usa `FastifyRequest.ip` com `trustProxy: false` para identificar o IP do socket direto. Cabeçalhos de encaminhamento enviados pelo cliente não participam do limite. Se o IP estiver ausente ou inválido, os endpoints de login e pedido de recuperação falham fechados com `503`.

Os contadores de falha de login e de pedido de recuperação por origem são separados e compartilhados em PostgreSQL. Apenas HMAC do IP é persistido. Uma transação curta reserva uma tentativa por origem antes da autenticação; outra finaliza a reserva e registra a falha. As reservas expiram após dez minutos para recuperar tentativas interrompidas. O provedor de identidade é chamado fora da transação de origem. Falha de disponibilidade do provedor não conta como senha inválida. O quinto evento inicia bloqueio de cinco minutos; eventos posteriores após o bloqueio prolongam a duração em passos de cinco minutos até 60. O contador por identidade continua vigente. A resposta de pedido de recuperação permanece genérica para endereços existentes, inexistentes e limitados.

O bloqueio por e-mail de login e conclusão de recuperação usa lease PostgreSQL com HMAC do e-mail, renovado enquanto a ação está em andamento. Nenhuma transação fica aberta durante chamadas ao provedor ou emissão de sessão. Uma falha na verificação da identidade após o login é tratada como indisponibilidade, sem somar tentativa de senha inválida.

Uma implantação atrás de proxy exige lista explícita de IPs/CIDRs confiáveis e verificação de que o IP encaminhado foi produzido por esse proxy. Não usar `trustProxy: true` indiscriminadamente nem confiar em cabeçalhos do cliente. Sem essa configuração, a API vê o IP do proxy como origem e limita seus clientes em conjunto.

Referências: [Fastify Request](https://fastify.dev/docs/latest/Reference/Request/) e [Fastify Server](https://fastify.dev/docs/latest/Reference/Server/).
