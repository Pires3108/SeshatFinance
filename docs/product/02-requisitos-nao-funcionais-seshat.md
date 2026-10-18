# Seshat Finance — Requisitos não funcionais

## 1. Objetivo

Este documento estabelece as qualidades operacionais, de segurança, privacidade, desempenho e manutenção da Seshat Finance. Os valores não fornecidos foram definidos como baselines realistas para uma primeira versão de uma aplicação financeira organizacional hospedada inicialmente em camada gratuita.

## 2. Plataforma e compatibilidade

- **RNF-001 — Entrega:** aplicação web responsiva e instalável como PWA.
- **RNF-002 — Desktop:** interface otimizada para telas a partir de 1280 px e funcional a partir de 768 px.
- **RNF-003 — Navegadores:** duas versões estáveis mais recentes de Chrome, Edge e Opera; Safari 17 ou superior.
- **RNF-004 — Conectividade:** operações financeiras exigem conexão; sem rede, mostrar estado de indisponibilidade e não aceitar gravações locais.
- **RNF-005 — Localidade:** português do Brasil, fuso configurável com padrão America/Sao_Paulo, datas brasileiras e BRL como moeda consolidada.

## 2.1 Isolamento de sistemas financeiros

- A arquitetura não deve possuir credenciais, certificados, tokens ou permissões capazes de iniciar, autorizar, impedir ou cancelar transações em instituições externas.
- Importações são unidirecionais para leitura e organização. Exportações geram arquivos para o usuário e nunca instruções executáveis por instituições financeiras.
- Integrações futuras de consulta devem ser estritamente somente leitura e submetidas a revisão de segurança e escopo.

## 3. Desempenho e capacidade

- **RNF-006 — Navegação:** 95% das telas comuns devem responder em até 2 segundos, desconsiderada a ativação inicial de serviços gratuitos adormecidos.
- **RNF-007 — Gravação:** 95% das criações e edições simples devem confirmar em até 2 segundos.
- **RNF-008 — Pesquisa:** consultas em até 100 mil movimentações por usuário devem retornar em até 3 segundos no percentil 95.
- **RNF-009 — Painel:** a visão anual deve carregar em até 4 segundos no percentil 95.
- **RNF-010 — Importação:** lotes de até 10 mil linhas ou 20 MB devem ser processados em segundo plano, com progresso, em até 2 minutos em condições normais.
- **RNF-011 — Exportação:** até 100 mil registros devem ser processados em segundo plano, com progresso e resultado recuperável.
- **RNF-012 — Capacidade inicial por usuário:** 100 contas, 100 mil movimentações, 500 entidades, 500 categorias e etiquetas, 100 metas, 1.000 posições de investimento e 5 GB de anexos, sujeito às cotas da infraestrutura.

## 4. Disponibilidade e continuidade

- **RNF-013 — Disponibilidade:** buscar 99,5% ao mês, excluindo manutenção programada comunicada com 48 horas de antecedência.
- **RNF-014 — Restrição:** enquanto depender exclusivamente de camadas gratuitas, 99,5% será objetivo operacional, não garantia contratual.
- **RNF-015 — Backups:** executar backup diário criptografado e manter versões por no mínimo 14 dias.
- **RNF-016 — RPO:** limitar a perda potencial de dados a 24 horas em desastre.
- **RNF-017 — RTO:** restaurar o serviço em até 8 horas após declaração de desastre.
- **RNF-018 — Teste:** testar restauração de backup trimestralmente.
- **RNF-019 — Monitoramento:** monitorar disponibilidade, erros, filas, latência, backups e eventos suspeitos, sem dados pessoais ou valores financeiros nos alertas.
- **RNF-020 — Ambientes:** separar desenvolvimento, homologação e produção.

## 5. Segurança

- **RNF-021 — Referência:** adotar controles proporcionais ao OWASP ASVS 5.0 nível 2.
- **RNF-022 — Transporte:** usar HTTPS em todas as conexões públicas, TLS 1.2 ou superior e redirecionamento de HTTP.
- **RNF-023 — Repouso:** criptografar banco, backups e anexos; proteger adicionalmente segredos, tokens TOTP e identificadores financeiros.
- **RNF-024 — Senhas:** armazenar somente hashes Argon2id ou usar serviço de identidade com proteção equivalente. Senhas novas de cadastro e recuperação devem ter pelo menos 12 caracteres e ser verificadas no servidor contra senhas comprometidas via Pwned Passwords, sem enviar a senha ou o hash completo ao serviço; indisponibilidade da verificação impede a gravação.
- **RNF-025 — Tentativas:** após cinco falhas consecutivas, aplicar bloqueio temporário progressivo e limitação por conta e origem.
- **RNF-026 — Sessão:** expirar após 30 minutos de inatividade e, no máximo, 12 horas após autenticação; invalidar no servidor ao sair, trocar senha ou encerrar remotamente.
- **RNF-027 — Cookies:** a sessão do navegador usa token opaco aleatório exclusivamente em cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` e `Path=/`; somente o hash do token é persistido. Tokens do provedor de identidade não são expostos ao navegador. Ver ADR-013.
- **RNF-028 — Reautenticação:** exigir senha e, quando ativo, 2FA para eliminar conta, desativar 2FA, alterar e-mail, revelar dados mascarados ou purgar registros.
- **RNF-029 — Autorização:** validar autorização no servidor em toda operação.
- **RNF-030 — Arquivos:** validar tipo real, extensão, tamanho e conteúdo de anexos e importações; armazená-los fora do caminho executável.
- **RNF-031 — Segredos:** manter chaves e credenciais fora do código-fonte e permitir rotação.
- **RNF-032 — Auditoria:** registros devem ser somente anexáveis, protegidos contra alteração e sem senhas, tokens completos ou conteúdo de anexos.
- **RNF-033 — Ciclo seguro:** executar análise de dependências, análise estática e testes de segurança antes de cada liberação.

## 6. Privacidade e LGPD

- **RNF-034 — Minimização:** coletar apenas dados necessários e informar finalidade e base de tratamento.
- **RNF-035 — Direitos:** oferecer acesso, correção, portabilidade e solicitação de eliminação.
- **RNF-036 — Eliminação:** bloquear acesso imediatamente e eliminar ou anonimizar dados ativos em até 24 horas, salvo obrigação legal ou vínculo compartilhado legítimo.
- **RNF-037 — Backups:** dados eliminados podem permanecer inacessíveis em backups por até 14 dias e devem expirar no ciclo normal.
- **RNF-038 — Compartilhamento:** informar claramente quais dados serão compartilhados com o grupo e exigir ação explícita.
- **RNF-039 — Portabilidade:** gerar pacote legível por máquina em JSON e CSV sem contato com suporte.
- **RNF-040 — Suporte:** suporte por e-mail não terá acesso direto ao conteúdo financeiro.

## 7. Acessibilidade e usabilidade

- **RNF-041 — Conformidade:** atender WCAG 2.2 AA nas jornadas essenciais.
- **RNF-042 — Teclado:** todas as ações devem funcionar por teclado, com foco visível e ordem lógica.
- **RNF-043 — Semântica:** campos, erros, tabelas, gráficos e controles devem ter nomes e relações compreensíveis por tecnologia assistiva.
- **RNF-044 — Cor:** informação não deve depender apenas de cor.
- **RNF-045 — Contraste:** atender contraste AA e permanecer utilizável com zoom de 200%.
- **RNF-046 — Erros:** operações destrutivas ou financeiras devem mostrar resumo e confirmação; ações reversíveis devem oferecer restauração.

## 8. Qualidade e manutenção

- **RNF-047 — Precisão:** usar tipo decimal e regra explícita de arredondamento por moeda.
- **RNF-048 — Datas:** persistir instantes em UTC e apresentar no fuso do usuário; datas civis devem manter sua natureza.
- **RNF-049 — Integridade:** operações pareadas, reversões e conversões devem ser transacionais e idempotentes.
- **RNF-050 — Migração:** versionar alterações de esquema e permitir reversão quando tecnicamente possível.
- **RNF-051 — Testes:** manter testes unitários, integração, ponta a ponta, segurança, desempenho e acessibilidade nas funções críticas.
- **RNF-052 — Cobertura crítica:** saldo, fatura, parcelamento, juros, transferência e reversão devem possuir testes automatizados normais e de limite.
- **RNF-053 — Portabilidade técnica:** preferir código aberto e serviços gratuitos sem cartão na fase inicial, evitando dependência irremovível.
- **RNF-054 — Documentação:** versionar contratos de API, modelo de dados, decisões arquiteturais e recuperação.

## 9. Retenção

- **RNF-055 — Histórico:** manter contas, movimentações, faturas e investimentos arquivados enquanto a conta do usuário existir.
- **RNF-056 — Lixeira:** reter itens excluídos logicamente por 30 dias antes da purga automática, respeitando dependências.
- **RNF-057 — Projeções:** mover eventos opcionais vencidos ao arquivo após 14 dias e mantê-los por três meses; obrigações permanecem ativas até resolução.
- **RNF-058 — Auditoria:** manter logs por 12 meses ou até a eliminação da conta, prevalecendo o que ocorrer primeiro, salvo investigação de segurança documentada.

## 10. Referências

- [OWASP Application Security Verification Standard 5.0](https://owasp.org/projects/asvs)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Lei Geral de Proteção de Dados Pessoais](https://www.gov.br/mj/pt-br/assuntos/sua-protecao/sedigi/Lei13709.pdf)
- [MDN — Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
