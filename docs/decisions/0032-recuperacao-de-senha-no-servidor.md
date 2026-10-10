# ADR-032 — Conclusão da recuperação de senha no servidor

**Status:** aceita para US-015 em 10/10/2026; limite por origem permanece em US-018.

## Contexto

O link padrão de recuperação do Supabase confirma o token no provedor e redireciona o navegador com uma sessão do provedor. A aplicação usa sessões opacas próprias conforme ADR-013 e não deve expor tokens de acesso ou refresh do provedor ao navegador.

## Decisão técnica

O template de e-mail de recuperação deve usar `<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Redefinir senha</a>`. `AUTH_PASSWORD_RECOVERY_REDIRECT_URL` aponta para a rota web `/auth/reset-password`, cadastrada na lista de redirecionamentos permitidos do Supabase. A página remove o fragmento do histórico imediatamente e envia o hash por `POST` ao proxy web, que encaminha a requisição à API. O fragmento evita incluir o token no URL da requisição HTTP inicial e no cabeçalho `Referer`, mas o token ainda transita brevemente pelo JavaScript do navegador.

A API verifica a disponibilidade do banco antes de trocar o `token_hash` com `verifyOtp` do tipo `recovery` e usa a sessão resultante somente no cliente Supabase criado para essa requisição. A API atualiza a senha com `updateUser`, sem devolver tokens do provedor. O token de recuperação é de uso único e sua validade é imposta pelo Supabase. Após identificar o e-mail confirmado pelo provedor, a recuperação adquire o mesmo bloqueio transacional por identidade usado pelo login. O login mantém esse bloqueio até a sessão opaca ser emitida. Sob o bloqueio, a API revoga todas as sessões opacas antes da alteração, para falhar sem alterar a senha se o banco estiver indisponível, e novamente após a alteração. Assim, uma autenticação com a senha antiga concluída antes da atualização ou emite a sessão antes da revogação, ou aguarda a nova senha.

Antes de cadastro ou troca de senha, a API exige pelo menos 12 caracteres e consulta a API gratuita Pwned Passwords por k-anonymity, enviando apenas os cinco primeiros caracteres do SHA-1 e requisitando resposta com padding. Na recuperação, a consulta ocorre somente após `verifyOtp` confirmar o token e dentro do bloqueio por identidade, antes de qualquer revogação ou atualização de senha; o token pode ser consumido mesmo se a senha for rejeitada ou a consulta falhar. Uma senha comprometida recebe rejeição genérica; indisponibilidade da consulta impede a gravação. Nenhuma senha nem hash completo é enviado ou registrado. O serviço de identidade continua responsável pelo hash armazenado; a proteção paga contra senhas vazadas do Supabase não é pressuposta.

O contrato público de conclusão é `POST /api/v1/auth/password-recovery-completions` com `{ tokenHash, password }`: `204` em sucesso, `400` genérico para token inválido, expirado ou reutilizado, `422` para senha rejeitada e `503` quando a verificação ou o provedor estiver indisponível. O pedido de e-mail mantém resposta genérica `202` para endereços existentes, inexistentes e identidades temporariamente limitadas. Uma tabela PostgreSQL própria limita pedidos por identidade normalizada após cinco solicitações, com bloqueio progressivo de 5 a 60 minutos. A chave persistida é HMAC do e-mail, sem e-mail em claro. Um processo na inicialização e a cada hora remove contadores sem atualização há mais de sete dias. Limitação por origem confiável é escopo de US-018.

## Limites

Uma atualização de senha no provedor e a revogação no banco não compartilham transação distribuída. Uma falha na segunda revogação deve ser tratada como indisponibilidade, investigada e reconciliada operacionalmente; a primeira revogação reduz a exposição. Uma falha após `verifyOtp` pode consumir o link sem alterar a senha: a interface oferece solicitar outro link. A consulta à API gratuita Pwned Passwords introduz dependência de disponibilidade; a falha retorna resposta genérica `503` sem gravar senha. US-018 deve completar a proteção por origem exigida em RNF-025.

## Referências

- [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords)
