# Seshat Finance — validação pública de acessibilidade e PWA em 24/09/2026

## 1. Escopo e evidência

Esta validação cobre somente as jornadas públicas que existem no código: cadastro, solicitação de recuperação de senha e rota de indisponibilidade. Foi executada no navegador integrado local, contra o servidor de desenvolvimento em `localhost`, em 24/09/2026.

Ela não comprova uma matriz de navegadores, instalação real, operação sem rede por um service worker ativo, login, sessão nem qualquer jornada financeira autenticada.

## 2. Resultados observados

| Jornada            | Verificação                                                                | Resultado |
| ------------------ | -------------------------------------------------------------------------- | --------- |
| `/cadastro`        | Carregamento, conteúdo e ausência de overlay de erro                       | aprovado  |
| `/cadastro`        | Primeiro foco no atalho “Pular para o conteúdo” e ativação para `main`     | aprovado  |
| `/cadastro`        | Nome, e-mail, senha e ação expostos com rótulos acessíveis                 | aprovado  |
| `/cadastro`        | Submissão vazia devolve foco ao campo obrigatório e expõe mensagem nativa  | aprovado  |
| `/recuperar-senha` | Carregamento, conteúdo, atalho e rótulo do e-mail                          | aprovado  |
| `/recuperar-senha` | E-mail inválido devolve foco ao campo e expõe mensagem nativa              | aprovado  |
| `/recuperar-senha` | Manifesto presente e nenhum erro de console capturado                      | aprovado  |
| `/offline`         | Mensagem de indisponibilidade renderizada como título e conteúdo principal | aprovado  |

## 3. Limites conhecidos

- O navegador integrado não expôs a API de registro de service worker; a presença do manifesto foi observada, mas o ciclo de instalação/ativação não foi inspecionado.
- Não foi simulada perda de rede, portanto a rota `/offline` foi validada diretamente e não como fallback automático da navegação.
- Não houve instalação em Chrome, Edge, Safari, Android ou iOS. US-098 permanece parcial até executar essa matriz em navegadores e dispositivos reais.
- A evidência não substitui uma auditoria WCAG 2.2 AA completa. US-095 permanece parcial; as jornadas autenticadas dependem da estratégia de sessão registrada em RII-005.

## 4. Próxima evidência necessária

Executar a matriz de instalação e atualização PWA nos navegadores/dispositivos suportados, verificar o fallback após desconexão real e registrar versões, dispositivo, resultado e defeitos encontrados. Qualquer correção deverá acrescentar teste automatizado quando viável.
