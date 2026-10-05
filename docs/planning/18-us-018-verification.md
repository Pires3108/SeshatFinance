# US-018 — Evidência e pendências de autenticação

Verificação de 05/10/2026 para SESHAT-35, PR #123, commit funcional `a46d9a3e3d6703314adc3380fdc9b16c4ae34617`.

## Evidência publicada

- [CI 37311668663](https://github.com/Pires3108/SeshatFinance/actions/runs/37311668663): `quality` e `browser-auth` concluíram com sucesso. O primeiro executa formatação, build, lint, tipos, testes, integração PostgreSQL e consistência OpenAPI/cliente; o segundo executa Playwright em Chromium, Firefox e WebKit.
- Os testes PostgreSQL exercitam clientes independentes, concorrência, limites de 5/10/20/40/80 minutos, limite exato com relógio controlado e ausência de e-mail bruto no estado persistido. Os testes de sessão exercitam inatividade e expiração absoluta.
- A jornada de navegador usa respostas sintéticas interceptadas. A confirmação do e-mail é simulada, assim como o consumo do link de recuperação. Esses testes comprovam interface e acessibilidade, sem comprovar as garantias do provedor real.
- O webhook GitHub `684550299` permanece ativo para `check_run` e `workflow_run`; os eventos finais deste CI receberam HTTP 202 em 05/10/2026.

## Bloqueio de aceitação

AC4 requer link de recuperação de uso único e com expiração. ADR-028 registra que falta a duração explicitamente aceita e a comprovação de primeiro uso, reutilização rejeitada e expiração contra Supabase real. Não inferir a duração nem tratar mocks como prova da configuração. Registrar a decisão, configurar o template e a expiração no ambiente autorizado e executar a integração antes de concluir a história. SESHAT-35 permanece Blocked por esse critério.

## Implantação externa

O deployment `dpl_GBNh4RNCMYU4BywoJtVtr1XG1JB8` do projeto externo `agent-waiter` falhou antes do build com `NOW_SANDBOX_WORKER_ROOTDIR_NOT_EXIST`: o Root Directory configurado é `tools/agent-waiter`, inexistente neste incremento. Essa falha não corresponde aos gates da aplicação, que passaram. O projeto também recebe o webhook; alterar sua raiz para publicar a aplicação financeira mudaria a finalidade do serviço. O proprietário deve confirmar o artefato e a configuração desse projeto antes da correção. Esse diagnóstico não é a causa do bloqueio de AC4.
