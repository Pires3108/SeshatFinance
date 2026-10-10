# Operação da recuperação e verificação de senhas

## Dependências

- Aplicar a migration `20261010120000_recovery_request_attempts` antes de publicar a API com limitação de pedidos. A tabela usa HMAC do e-mail e não armazena endereços em claro. A API remove contadores com mais de sete dias na inicialização e a cada hora; monitorar crescimento da tabela e conectividade PostgreSQL.
- Configurar `AUTH_PASSWORD_RECOVERY_REDIRECT_URL` para a rota web `/auth/reset-password` permitida no Supabase e usar no template de recuperação `<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Redefinir senha</a>`.
- A API precisa alcançar `https://api.pwnedpasswords.com/range/` por HTTPS. A consulta é gratuita, não requer chave e envia apenas cinco caracteres do SHA-1 da senha. O request inclui `Add-Padding: true` e `User-Agent: SeshatFinance-PasswordSafety/1.0`. Não usar o recurso pago de proteção contra senhas vazadas do Supabase como condição para este fluxo.

## Verificação antes da publicação

1. Confirmar migration aplicada e conectividade PostgreSQL.
2. Confirmar que cadastro e recuperação rejeitam senha com menos de 12 caracteres antes de chamar o provedor.
3. Confirmar que senha conhecida como comprometida recebe `422` genérico e que falha/timeout da API Pwned Passwords recebe `503` sem criar conta ou alterar senha. Na recuperação, o token já foi confirmado e pode ser consumido; solicitar outro link.
4. Confirmar `202` e corpo idêntico para pedido de recuperação de e-mail existente, inexistente e temporariamente limitado.
5. Confirmar que a troca de senha revoga todas as sessões opacas e que link expirado ou reutilizado não altera a senha.

## Falhas

- `503` na verificação de senha exige restaurar acesso à API Pwned Passwords; não desabilitar a verificação nem registrar a senha/hash para diagnóstico.
- `503` após consumir o token do Supabase pode exigir novo link; a interface oferece essa ação. Não reutilizar o token.
- Não registrar e-mail, descrição financeira, senha, hash completo, token de recuperação ou corpo da resposta Pwned Passwords em logs.
- O limite por origem confiável ainda pertence à US-018; não afirmar cobertura integral de RNF-025 antes dela.
