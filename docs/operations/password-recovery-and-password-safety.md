# Operação da recuperação e verificação de senhas

## Dependências

- Aplicar a migration `20261010120000_recovery_request_attempts` antes de publicar a API com limitação de pedidos. A tabela usa HMAC do e-mail e não armazena endereços em claro. A API remove contadores com mais de sete dias na inicialização e a cada hora; monitorar crescimento da tabela e conectividade PostgreSQL.
- Aplicar `20261013120000_auth_origin_attempts` e `20261013130000_login_leases` antes de publicar US-018. O IP de origem é o socket direto da API (`trustProxy: false`); antes de posicionar a API atrás de proxy, configurar uma lista explícita de IPs/CIDRs confiáveis e verificar a origem encaminhada. Não confiar em `X-Forwarded-For` enviado pelo cliente. As tabelas guardam apenas HMAC do IP ou e-mail. Reservas e leases expiram após dez minutos; o lease por e-mail é renovado a cada minuto com o relógio do PostgreSQL enquanto a ação está em andamento. A rotina de manutenção remove leases expirados a cada hora e na inicialização; contadores sem atualização são removidos após sete dias. A chamada de autenticação e a verificação da identidade têm limite individual de 30 segundos.
- Em teste manual com Supabase Auth local e identidade sintética, confirmação e login funcionaram. O primeiro uso do link de recuperação gerou sessão; repetição do mesmo link e uso de um novo link após 65 segundos com validade de 60 segundos retornaram `otp_expired`. Esta evidência valida o comportamento observado do provedor local e não substitui os gates automatizados da API.
- Configurar `AUTH_PASSWORD_RECOVERY_REDIRECT_URL` para a rota web `/auth/reset-password` permitida no Supabase e usar no template de recuperação `<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Redefinir senha</a>`.
- A API precisa alcançar `https://api.pwnedpasswords.com/range/` por HTTPS. A consulta é gratuita, não requer chave e envia apenas cinco caracteres do SHA-1 da senha. O request inclui `Add-Padding: true` e `User-Agent: SeshatFinance-PasswordSafety/1.0`. Não usar o recurso pago de proteção contra senhas vazadas do Supabase como condição para este fluxo.
- Cada processo da API permite até oito consultas Pwned Passwords em andamento; novas consultas durante saturação recebem `503` sem espera.

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
- Se a API receber IP ausente ou inválido, login e pedido de recuperação retornam `503`; verificar a configuração da rede antes de repetir.
