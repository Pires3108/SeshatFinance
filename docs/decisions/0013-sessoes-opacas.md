# ADR-013 — Sessões opacas próprias

**Status:** aceita em 27/09/2026, conforme a decisão registrada em [SESHAT-30](https://nicolaspires.atlassian.net/browse/SESHAT-30).

## Contexto

O Supabase Auth valida as credenciais, mas a aplicação precisa revogar sessões e aplicar 30 minutos de inatividade e 12 horas de duração absoluta sem expor tokens do provedor ao navegador.

## Decisão

A API emite um token aleatório de 256 bits em cookie `__Host-` com `HttpOnly`, `Secure`, `SameSite=Lax` e `Path=/`. Somente o hash SHA-256 do token é persistido. A API valida a expiração e a revogação em cada uso; o logout revoga o registro no servidor e expira o cookie. Tokens de acesso e refresh do Supabase são descartados após a autenticação e nunca retornam ao navegador. O browser usa a rota web da mesma origem para login, consulta e logout.

## Consequências

Sessões exigem persistência própria e atualização de último uso. A validação em banco precisa ser condicional para que a revogação e a expiração não sejam vencidas por requisições concorrentes. A autenticação de API por bearer para clientes técnicos permanece isolada do fluxo de sessão do navegador.

## Alternativas consideradas

Persistir tokens de refresh do provedor ou enviá-los ao navegador foi descartado pelo risco de exposição e pela dificuldade de impor revogação e duração próprias.
