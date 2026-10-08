# Seshat Finance — Backlog, roadmap e sprints

## 1. Objetivo

Este documento converte requisitos, arquitetura, invariantes e estratégia de testes em uma sequência executável de desenvolvimento.

O plano usa sprints de duas semanas como unidade de organização. A numeração indica dependência e ordem recomendada, não datas prometidas. Após duas ou três sprints reais, o volume deverá ser recalibrado pela velocidade observada.

## 2. Premissas

- Equipe pequena e multidisciplinar.
- Monólito modular com web, API e worker.
- Desenvolvimento orientado por histórias verticais sempre que possível.
- Infraestrutura inicial com custo zero ou camada gratuita.
- MVP individual antes de grupos familiares.
- Atualização automática de investimentos somente após o MVP.
- Nenhuma funcionalidade pode operar transações financeiras externas.
- Segurança, acessibilidade, auditoria e testes fazem parte das histórias; não são fases opcionais.

## 3. Marcos

### Marco M0 — Base pronta

Monorepo, CI, ambientes, banco, autenticação mínima, observabilidade e padrões funcionando.

### Marco M1 — Livro financeiro pessoal

Usuário consegue cadastrar contas e registrar, editar, arquivar e reconciliar movimentações com saldos corretos.

### Marco M2 — Gestão completa do MVP

Cartões, metas, investimentos manuais, projeções, importações, exportações, relatórios e notificações estão utilizáveis.

### Marco M3 — Release candidate

Segurança, acessibilidade, desempenho, backup, restauração, retenção e critérios de aceitação foram comprovados.

### Marco M4 — Família

Contas privadas e compartilhadas com papéis e auditoria.

### Marco M5 — Investimentos conectados

Cotações e eventos automáticos somente leitura, com proveniência e correção manual.

## 4. Épicos

### EP-00 — Fundação da plataforma

Monorepo, ferramentas, CI, ambientes, configuração, observabilidade e documentação operacional.

### EP-01 — Identidade e acesso

Cadastro, login, recuperação, 2FA, sessões, perfil, portabilidade e eliminação.

### EP-02 — Contas e saldos

Contas, tipos, moedas, saldo inicial, conciliação, arquivo e lixeira.

### EP-03 — Classificações e entidades

Categorias, subcategorias, etiquetas, centros de custo, pessoas, empresas e instituições.

### EP-04 — Movimentações

Receitas, despesas, transferências representativas, ajustes, reembolsos, empréstimos, anexos e auditoria.

### EP-05 — Cartões e faturas

Cartões, ciclos, compras, parcelas, juros, fechamento, quitação e pagamento parcial.

### EP-06 — Metas e reservas

Metas, contribuições, reservas, progresso e orçamentos.

### EP-07 — Investimentos manuais

Posições, eventos, rentabilidade, moedas e consolidação patrimonial.

### EP-08 — Projeções e cenários

Recorrências, eventos futuros, horizonte, cenários e confirmação organizacional.

### EP-09 — Visão geral e exploração

Painéis, gráficos, períodos, pesquisa, filtros, ordenação e relatórios.

### EP-10 — Importação

OFX, CSV, XLSX, JSON, PDF, OCR, staging, duplicidades e reversão.

### EP-11 — Exportação

CSV, XLSX, JSON, PDF, filtros, geração assíncrona e portabilidade.

### EP-12 — Notificações, auditoria e retenção

Central interna, gatilhos, histórico, lixeira, retenção e jobs de limpeza.

### EP-13 — Qualidade operacional

Segurança, acessibilidade, desempenho, compatibilidade, backup, restauração e release.

### EP-14 — Família

Grupos, convites, papéis, contas privadas e compartilhadas, titularidade e autoria.

### EP-15 — Investimentos automáticos

Provedores somente leitura, cotações, eventos, proveniência e reconciliação.

## 5. Critério de pronto para desenvolvimento

Uma história pode entrar em sprint quando:

- objetivo e valor estão claros;
- requisitos, regras e invariantes foram identificados;
- critérios de aceitação são verificáveis;
- dependências estão disponíveis;
- impacto em dados, segurança, acessibilidade e auditoria foi avaliado;
- tamanho cabe em uma sprint ou foi dividido;
- não há decisão arquitetural bloqueadora.

## 6. Definição de concluído

Uma história está concluída quando:

- implementação atende ao critério;
- revisão de código foi aprovada;
- testes unitários e de integração aplicáveis foram adicionados;
- jornada crítica possui E2E quando necessário;
- invariantes afetadas foram executadas;
- autorização e auditoria foram verificadas;
- interface atende acessibilidade aplicável;
- OpenAPI, migration e documentação foram atualizados;
- pipeline está verde;
- não há defeito P0 ou P1.

## 7. Plano do MVP

### Sprint 0 — Repositório e experiência de desenvolvimento

**Objetivo:** tornar possível desenvolver, testar e executar todos os processos localmente.

- **US-001 [EP-00, M]** Criar monorepo pnpm com apps web, api e worker e packages definidos na arquitetura.
- **US-002 [EP-00, M]** Configurar TypeScript estrito, lint, formatação, aliases e verificação de limites entre packages.
- **US-003 [EP-00, M]** Configurar Docker Compose com PostgreSQL e serviços locais necessários.
- **US-004 [EP-00, M]** Configurar CI com instalação imutável, lint, tipos, unitários e build.
- **US-005 [EP-00, S]** Instalar AGENTS.md, estrutura de ADRs e templates de pull request.
- **US-006 [EP-00, S]** Criar health checks básicos para API e worker.

**Saída:** todos os apps iniciam; um pull request executa o pipeline mínimo.

### Sprint 1 — Persistência, contratos e observabilidade

**Objetivo:** construir a fundação transversal da API.

- **US-007 [EP-00, L]** Configurar Prisma, schema inicial, migrations e seeds sintéticos.
- **US-008 [EP-00, M]** Implementar envelope de erro, correlationId e logs estruturados sem dados financeiros.
- **US-009 [EP-00, M]** Configurar REST v1, validação Zod e geração OpenAPI.
  - Contrato verificável: requisições autenticadas válidas executam o caso de uso e retornam a forma documentada; entrada monetária inválida é rejeitada antes da escrita; divergência entre OpenAPI gerado e versão publicada falha no CI.
  - O cabeçalho HTTP `Idempotency-Key` não integra o contrato da US-009. Sua semântica para transferências pertence à US-032 (SESHAT-48), incluindo repetição e concorrência; esta decisão não estende a US-032 a todos os comandos financeiros.
- **US-010 [EP-00, M]** Gerar cliente TypeScript para o frontend e verificar mudanças de contrato no CI.
- **US-011 [EP-00, M]** Configurar Vitest, Testcontainers e fixtures básicas.
- **US-012 [EP-00, S]** Implementar clock, gerador de IDs e abstrações de transação injetáveis.

**Dependência:** Sprint 0.

**Saída:** caso de uso de referência percorre HTTP, aplicação, domínio e banco com teste.

### Sprint 2 — Cadastro, login e sessões

**Objetivo:** permitir acesso seguro à aplicação.

- **US-013 [EP-01, L]** Integrar Supabase Auth por adaptador para cadastro com confirmação de e-mail.
- **US-014 [EP-01, M]** Implementar login, logout e tratamento seguro de sessão.
- **US-015 [EP-01, M]** Implementar recuperação de senha sem enumeração de usuários.
- **US-016 [EP-01, M]** Resolver ator autenticado na API e proteger endpoints.
- **US-017 [EP-01, S]** Criar perfil e preferências iniciais.
- **US-018 [EP-13, M]** Cobrir autenticação com testes de integração, rate limit e E2E.

**Referências:** RF-001 a RF-003, RF-005, RF-006; CA-001.

### Sprint 3 — Contas e moedas

**Objetivo:** permitir estruturar o patrimônio inicial.

- **US-019 [EP-02, L]** Implementar CRUD de contas, tipos, estado ativo e arquivamento.
- **US-020 [EP-02, M]** Implementar saldo inicial e cálculo de saldo contábil.
- **US-021 [EP-02, M]** Implementar Money, Currency e persistência Decimal.
- **US-022 [EP-02, M]** Implementar multimoeda e cotação manual com origem preservada.
- **US-023 [EP-02, S]** Criar lista e detalhes de contas com estados vazios e erros.
- **US-024 [EP-13, M]** Automatizar INV-003 a INV-006, INV-010 e INV-029.

**Referências:** RF-015 a RF-020; CA-003 e CA-024.

### Sprint 4 — Classificações, entidades e movimentações básicas

**Objetivo:** registrar receitas e despesas organizadas.

- **US-025 [EP-03, M]** Implementar categorias e subcategorias com catálogo inicial.
- **US-026 [EP-03, S]** Implementar etiquetas múltiplas.
- **US-027 [EP-03, S]** Implementar centros de custo.
- **US-028 [EP-03, M]** Implementar entidades e vínculos opcionais.
- **US-029 [EP-04, L]** Implementar criação, consulta e edição de receitas e despesas.
- **US-030 [EP-04, M]** Implementar visões diária, semanal e mensal básicas.
- **US-031 [EP-13, M]** Testar saldos, filtros de ownership e auditoria inicial.

**Referências:** RF-021 a RF-027, RF-030, RF-067 a RF-069; CA-004.

**Marco:** M1 parcial.

### Sprint 5 — Transferências, ajustes e ciclo de vida

**Objetivo:** completar o livro financeiro pessoal.

- **US-032 [EP-04, L]** Implementar registro pareado e atômico de transferência.
- **US-033 [EP-04, M]** Implementar conciliação e ajuste de saldo justificado.
- **US-034 [EP-04, M]** Implementar arquivamento, lixeira e restauração com recálculo.
- **US-035 [EP-12, M]** Implementar auditoria append-only de alterações financeiras.
- **US-036 [EP-04, M]** Implementar reembolso vinculado.
- **US-037 [EP-13, L]** Automatizar invariantes de transferência, ajuste e lixeira, incluindo concorrência.

**Referências:** RF-028, RF-029, RF-031, RF-032, RF-034, RF-088 a RF-090; CA-005 a CA-007.

**Marco:** M1 concluído.

### Sprint 6 — Cartões e ciclos de fatura

**Objetivo:** registrar compras e obrigações sem dupla contabilização.

- **US-038 [EP-05, M]** Implementar cadastro de cartão vinculado, limite e ciclo.
- **US-039 [EP-05, L]** Implementar compra no cartão e obrigação da fatura.
- **US-040 [EP-05, L]** Implementar formação e fechamento manual da fatura.
- **US-041 [EP-05, L]** Implementar registro de quitação sem duplicar despesa.
- **US-042 [EP-05, M]** Implementar estados visuais de atenção e atraso.
- **US-043 [EP-13, L]** Automatizar INV-014 a INV-018 e E2E de compra até quitação.

**Referências:** RF-038, RF-039, RF-043 a RF-046; CA-008.

### Sprint 7 — Parcelas, juros e empréstimos

**Objetivo:** controlar compromissos parcelados e valores a receber ou pagar.

- **US-044 [EP-05, XL]** Implementar parcelamento, arredondamento e memória de cálculo.
- **US-045 [EP-05, L]** Implementar juros simples e compostos por periodicidade.
- **US-046 [EP-05, M]** Implementar antecipação, renegociação e pagamento parcial organizacional.
- **US-047 [EP-04, L]** Implementar empréstimos, parcelas, vencimentos e saldo pendente.
- **US-048 [EP-13, L]** Aplicar testes baseados em propriedades e mutação aos cálculos.

**Referências:** RF-035, RF-040 a RF-045; CA-009.

### Sprint 8 — Metas, reservas e orçamentos

**Objetivo:** permitir planejamento e acompanhamento de objetivos.

- **US-049 [EP-06, M]** Implementar metas, alvo, prazo e contas vinculadas.
- **US-050 [EP-06, M]** Implementar contribuições divididas e progresso.
- **US-051 [EP-06, M]** Separar reserva, saldo disponível e patrimônio.
- **US-052 [EP-06, L]** Implementar orçamentos por período e dimensão.
- **US-053 [EP-13, M]** Automatizar INV-012, INV-013, INV-025 e INV-026.

**Referências:** RF-047 a RF-050, RF-072; CA-013.

### Sprint 9 — Investimentos manuais

**Objetivo:** consolidar investimentos sem integrações externas.

- **US-054 [EP-07, L]** Implementar cadastro dos tipos de investimento previstos.
- **US-055 [EP-07, L]** Implementar aportes, resgates, rendimentos, dividendos, taxas e impostos.
- **US-056 [EP-07, L]** Calcular posição, custo, valor atual e rentabilidade.
- **US-057 [EP-07, M]** Consolidar saldo investido e patrimônio em BRL.
- **US-058 [EP-13, M]** Automatizar INV-027 a INV-029.

**Referências:** RF-051 a RF-055; CA-014.

### Sprint 10 — Recorrências e eventos futuros

**Objetivo:** construir a base das previsões explícitas.

- **US-059 [EP-08, L]** Implementar regras de recorrência, pausa, início e fim.
- **US-060 [EP-08, L]** Gerar ocorrências projetadas por até 12 meses.
- **US-061 [EP-08, M]** Implementar eventos futuros opcionais e obrigatórios.
- **US-062 [EP-08, L]** Implementar confirmação organizacional idempotente.
- **US-063 [EP-12, M]** Implementar avisos de vencimento e estados arquivados.
- **US-064 [EP-13, L]** Automatizar INV-020, INV-021, INV-023 e INV-024.

**Referências:** RF-036, RF-037, RF-057 a RF-061, RF-063; CA-010 e CA-011.

### Sprint 11 — Cenários, painel e pesquisa

**Objetivo:** transformar registros em visão útil e comparável.

- **US-065 [EP-08, L]** Implementar cópias independentes de cenários.
- **US-066 [EP-09, L]** Implementar visão geral com cinco métricas patrimoniais.
- **US-067 [EP-09, L]** Implementar gráficos mensais e anuais acessíveis.
- **US-068 [EP-09, M]** Implementar pesquisa global.
- **US-069 [EP-09, M]** Implementar filtros e ordenações combináveis.
- **US-070 [EP-13, M]** Automatizar INV-022 e reconciliação dos painéis.

**Referências:** RF-062, RF-064 a RF-071; CA-012 e CA-018.

### Sprint 12 — Importação estruturada

**Objetivo:** importar dados estruturados com revisão e segurança.

- **US-071 [EP-10, L]** Criar upload temporário, lote e staging.
- **US-072 [EP-10, L]** Implementar OFX, CSV e JSON.
- **US-073 [EP-10, L]** Implementar XLSX e mapeamento de colunas.
- **US-074 [EP-10, L]** Implementar prévia editável e validações.
- **US-075 [EP-10, L]** Implementar detecção assistida de duplicidades.
- **US-076 [EP-13, L]** Automatizar INV-030 a INV-032 e arquivos maliciosos.

**Referências:** RF-074 a RF-079; CA-015.

### Sprint 13 — PDF, OCR e reversão

**Objetivo:** completar importação e garantir recuperação segura.

- **US-077 [EP-10, XL]** Implementar extração de PDF digital.
- **US-078 [EP-10, XL]** Implementar OCR de PDF escaneado no worker.
- **US-079 [EP-10, L]** Criar modelos iniciais para Inter, Nubank e Mercado Pago.
- **US-080 [EP-10, XL]** Implementar dependências e reversão atômica de lote.
- **US-081 [EP-13, L]** Testar idempotência, retry, dead-letter e INV-033 a INV-034.

**Referências:** RF-074 a RF-080; CA-015 e CA-016.

### Sprint 14 — Exportação, relatórios e notificações

**Objetivo:** permitir portabilidade, análise e acompanhamento.

- **US-082 [EP-11, L]** Implementar exportação CSV e JSON filtrada.
- **US-083 [EP-11, L]** Implementar XLSX em tabela única ou abas.
- **US-084 [EP-09, L]** Implementar relatórios imprimíveis em PDF.
- **US-085 [EP-11, M]** Implementar geração assíncrona, expiração e download seguro.
- **US-086 [EP-12, M]** Implementar central interna e preferências.
- **US-087 [EP-12, M]** Implementar gatilhos de saldo, fatura, obrigação e meta.
- **US-088 [EP-13, M]** Automatizar INV-035 e testes de autorização das exportações.

**Referências:** RF-073, RF-081 a RF-087; CA-017.

**Marco:** M2 concluído.

### Sprint 15 — Segurança, privacidade e identidade avançada

**Objetivo:** fechar controles obrigatórios antes do release candidate.

- **US-089 [EP-01, L]** Implementar MFA TOTP e recuperação segura.
- **US-090 [EP-01, L]** Implementar step-up 2FA por e-mail.
- **US-091 [EP-01, M]** Implementar lista e encerramento de sessões.
- **US-092 [EP-01, L]** Implementar pacote de portabilidade e eliminação.
- **US-093 [EP-13, L]** Executar verificação OWASP ASVS, autorização horizontal e upload.
- **US-094 [EP-13, M]** Automatizar INV-001, INV-002 e INV-036 a INV-044.

**Referências:** RF-004, RF-005, RF-007, RF-008; CA-002 e CA-020.

### Sprint 16 — Estabilização e release candidate

**Objetivo:** demonstrar qualidade operacional e preparar o MVP.

- **US-095 [EP-13, L]** Executar auditoria WCAG 2.2 AA e corrigir jornadas essenciais.
- **US-096 [EP-13, L]** Executar testes de desempenho e otimizar limites definidos.
- **US-097 [EP-13, L]** Implantar backup diário e comprovar restauração, RPO e RTO.
- **US-098 [EP-13, M]** Executar compatibilidade de navegadores e instalação PWA.
- **US-099 [EP-13, M]** Configurar monitoramento, alertas e runbooks.
- **US-100 [EP-13, L]** Executar regressão completa, corrigir P0/P1 e preparar release notes.
- **US-101 [EP-12, M]** Validar retenção, limpeza, arquivo e auditoria.

**Referências:** CA-021 a CA-024; RNF-013 a RNF-058.

**Marco:** M3 e MVP.

## 8. Pós-MVP

### Sprint 17 — Fundação dos grupos familiares

- **US-102 [EP-14, L]** Criar grupo, convite, aceite e saída.
- **US-103 [EP-14, L]** Implementar papéis e policy central.
- **US-104 [EP-14, M]** Implementar transferência de propriedade.
- **US-105 [EP-14, L]** Testar revogação imediata e INV-039 a INV-040.

### Sprint 18 — Contas privadas e compartilhadas

- **US-106 [EP-14, XL]** Implementar escopos individual e compartilhado.
- **US-107 [EP-14, L]** Implementar múltiplos titulares.
- **US-108 [EP-14, L]** Preservar autoria em registros compartilhados.
- **US-109 [EP-14, L]** Automatizar matriz de permissões e INV-036 a INV-038.

### Sprint 19 — Operações familiares

- **US-110 [EP-14, L]** Importar, exportar e reverter dados compartilhados conforme papel.
- **US-111 [EP-14, M]** Implementar metas, orçamentos e cenários compartilhados.
- **US-112 [EP-14, M]** Implementar auditoria consultável conforme papel.
- **US-113 [EP-13, L]** Executar segurança multi-tenant e regressão.

**Marco:** M4.

### Sprint 20 — Provedor de mercado e proveniência

- **US-114 [EP-15, M]** Avaliar e selecionar fonte de cotações somente leitura.
- **US-115 [EP-15, L]** Criar porta e adaptador de market data.
- **US-116 [EP-15, M]** Persistir cotação, fonte, instante e moeda.
- **US-117 [EP-15, M]** Implementar limites, cache e fallback.

### Sprint 21 — Atualização automática

- **US-118 [EP-15, L]** Atualizar valores de ativos elegíveis.
- **US-119 [EP-15, L]** Importar eventos suportados sem sobrescrever dados manuais.
- **US-120 [EP-15, M]** Permitir correção manual com proveniência preservada.
- **US-121 [EP-13, L]** Reconciliar rentabilidade automática e manual.

### Sprint 22 — Estabilização das integrações

- **US-122 [EP-15, L]** Implementar reconciliação de divergências.
- **US-123 [EP-15, M]** Implementar monitoramento e alertas do provedor.
- **US-124 [EP-15, L]** Testar indisponibilidade, dados atrasados e valores incorretos.
- **US-125 [EP-13, M]** Revisar privacidade, licenciamento e custos.

**Marco:** M5.

## 9. Dependências críticas

- EP-01 depende de EP-00.
- EP-04 depende de EP-02 e parcialmente de EP-03.
- EP-05 depende de EP-04.
- EP-06 e EP-07 dependem de contas e movimentações.
- EP-08 depende de movimentações, cartões e relógio injetável.
- EP-09 depende dos módulos que fornece dados aos painéis.
- EP-10 depende de contas, movimentações, worker, storage e filas.
- EP-11 depende de autorização, worker e storage.
- EP-14 depende de autorização central preparada desde o MVP.
- EP-15 depende de investimentos manuais estáveis e ADR do provedor.

## 10. Política de priorização

Ordem:

1. risco P0;
2. dependência que desbloqueia múltiplas histórias;
3. jornada vertical utilizável;
4. risco técnico desconhecido;
5. valor para o usuário;
6. otimização ou conveniência.

Nenhuma funcionalidade P2 ou P3 deve deslocar correção de saldo, segurança, privacidade ou restauração.

## 11. Gestão de escopo

- História XL deve ser dividida ou executada como spike mais entregas menores.
- Descoberta que altere regra financeira exige atualização dos documentos antes da implementação.
- Trabalho emergencial entra com impacto explícito na meta da sprint.
- Itens não concluídos retornam ao backlog e são replanejados; não são automaticamente carregados.
- Velocidade não deve ser aumentada reduzindo testes ou revisão.

## 12. Métricas de acompanhamento

- Objetivo da sprint atingido ou não.
- Lead time por história.
- Defeitos P0 e P1 escapados.
- Taxa de reabertura.
- Tempo de pipeline.
- Flakiness dos testes.
- Cobertura das invariantes afetadas.
- Percentual de histórias que entram prontas.
- Disponibilidade e desempenho somente após ambiente estável.

Story points ou velocidade não devem ser usados para comparar pessoas.

## 13. Riscos do roadmap

- OCR e diversidade de PDFs podem exceder uma sprint; manter importações estruturadas independentes.
- Camadas gratuitas podem suspender processos ou limitar workers; validar antes da implantação.
- 2FA por e-mail exige SMTP confiável e proteção contra abuso.
- Precisão de investimentos depende da qualidade dos dados inseridos ou do provedor futuro.
- Grupos familiares elevam significativamente o risco de autorização; permanecem pós-MVP.
- Relatórios e painéis podem degradar com volume; medir antes de criar infraestrutura analítica.

## 14. Próxima revisão

Revisar o roadmap:

- ao fim da Sprint 2;
- ao concluir M1;
- antes de iniciar importação PDF e OCR;
- antes do release candidate;
- sempre que capacidade da equipe ou escopo mudar materialmente.
