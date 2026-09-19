# Seshat Finance — Stack técnica

## 1. Objetivo

Este documento fixa a stack inicial da Seshat Finance e os critérios para sua evolução. A prioridade é preservar correção financeira, segurança e velocidade de desenvolvimento com baixo custo operacional.

As versões exatas devem ser as versões estáveis compatíveis no início da implementação e permanecer fixadas no lockfile. Atualizações importantes exigem revisão, testes e registro de decisão.

## 2. Decisão resumida

- Linguagem principal: TypeScript em modo estrito.
- Organização: monorepo com pnpm workspaces e Turborepo.
- Frontend: Next.js com App Router e React.
- API: NestJS sobre Fastify, REST e OpenAPI.
- Worker: processo Node.js separado, compartilhando módulos de aplicação.
- Banco: PostgreSQL.
- ORM e migrações: Prisma ORM.
- Autenticação: Supabase Auth por adaptador próprio.
- Arquivos: armazenamento compatível com S3, inicialmente Supabase Storage.
- Filas: pg-boss sobre PostgreSQL.
- Validação: Zod nas fronteiras e objetos de valor no domínio.
- Interface: Tailwind CSS, Radix UI e componentes próprios.
- Gráficos: Recharts, sempre acompanhados de resumo textual acessível.
- Testes: Vitest, Testcontainers, Playwright e axe-core.
- Observabilidade: logs estruturados, OpenTelemetry no backend e monitoramento de erros por adaptador.
- Desenvolvimento local: Docker Compose.
- CI inicial: GitHub Actions.
- Entrega: imagens OCI para API e worker; frontend implantável em plataforma Next.js.

## 3. Runtimes e ferramentas

### Node.js

Usar uma versão LTS ativa do Node.js, fixada em arquivo de versão e validada no CI. API, worker, scripts e frontend usam o mesmo runtime.

### TypeScript

- strict habilitado;
- noUncheckedIndexedAccess habilitado;
- exactOptionalPropertyTypes habilitado;
- tipos compartilhados somente quando representam contratos estáveis;
- proibição de any não justificado;
- datas, dinheiro e identificadores representados por tipos ou objetos de valor.

### pnpm e Turborepo

pnpm gerencia dependências e workspaces. Turborepo coordena build, lint, testes e cache sem interferir na arquitetura.

Estrutura prevista:

    apps/
      web/
      api/
      worker/
    packages/
      domain/
      application/
      contracts/
      database/
      ui/
      observability/
      test-support/

## 4. Frontend

### Next.js App Router

Responsabilidades:

- shell da PWA;
- renderização de páginas e layouts;
- autenticação visual;
- formulários, tabelas, painéis e gráficos;
- consumo exclusivo da API pública;
- cache apenas de dados não sensíveis e conforme política explícita.

Não deve calcular saldos oficiais, escrever diretamente no PostgreSQL, acessar tabelas via cliente Supabase, guardar dados financeiros para uso offline nem conter regras financeiras como fonte de verdade.

### React

Componentes de apresentação ficam separados de casos de uso. Estado remoto usa TanStack Query. Estado local permanece no componente ou em stores pequenas e específicas; não haverá store global genérica por padrão.

### Formulários e validação

React Hook Form coordena formulários e Zod valida formato e mensagens. A API repete toda validação; validação do navegador nunca é considerada controle de segurança.

### Interface e acessibilidade

Tailwind CSS fornece tokens e utilitários. Radix UI fornece primitivas acessíveis. O projeto mantém componentes próprios em packages/ui, sem copiar regra de negócio para a biblioteca visual.

Os gráficos usam Recharts, mas todo gráfico deve oferecer título, unidade, legenda quando necessária, resumo textual e acesso aos mesmos dados em formato tabular ou listado.

### PWA

O App Router fornece manifesto e metadados. O service worker deve permitir instalação, armazenar somente recursos estáticos, apresentar página de indisponibilidade, nunca enfileirar gravações financeiras offline e nunca persistir respostas financeiras sensíveis além do necessário.

## 5. Backend

### NestJS com Fastify

NestJS organiza módulos, injeção de dependências, interceptadores, filtros e OpenAPI. Fastify é o adaptador HTTP.

A API será REST versionada sob /api/v1.

O contrato OpenAPI é gerado e validado no CI. O cliente TypeScript do frontend é gerado a partir dele; o frontend não importa classes internas da API.

### Arquitetura interna

Cada módulo segue quatro camadas:

- domain: entidades, objetos de valor, políticas e invariantes;
- application: casos de uso, portas e transações;
- infrastructure: Prisma, filas, arquivos, autenticação e provedores;
- presentation: controladores HTTP, schemas e mapeamento.

Dependências apontam para dentro. O domínio não importa NestJS, Prisma, Supabase, HTTP ou bibliotecas de interface.

### Módulos iniciais

- identity;
- users;
- households;
- accounts;
- classifications;
- counterparties;
- transactions;
- cards;
- goals;
- investments;
- forecasts;
- imports;
- exports;
- notifications;
- audit;
- files;
- reporting.

Households e atualização automática de investimentos ficam desativados por feature flag até sua fase.

## 6. Domínio financeiro

packages/domain será a fonte de verdade para Money, Currency, ExchangeRate, AccountBalance, Transaction, TransferPair, CreditCardStatement, InstallmentPlan, InterestRate, GoalAllocation, InvestmentPosition, ForecastEvent, ImportBatch e invariantes financeiras.

Dinheiro nunca usa number para cálculos. A representação será Decimal com moeda explícita. Na persistência, usar numeric com precisão definida por campo.

Casos de uso que alteram mais de um registro utilizam transação de banco. Operações repetíveis usam chave de idempotência.

## 7. Dados

### PostgreSQL

PostgreSQL é a única fonte persistente de verdade na primeira arquitetura por oferecer transações ACID, constraints, numeric exato, JSONB controlado, concorrência madura e portabilidade.

### Prisma ORM

Prisma é usado para schema, migrações, acesso tipado, transações, mapeamento Decimal, seeds e testes.

SQL explícito é permitido para relatórios, locks ou recursos não expressos adequadamente pelo ORM, desde que parametrizado, revisado e testado.

### Convenções

- IDs UUID ou UUIDv7.
- Instantes em timestamptz e UTC.
- Datas civis em date.
- Valores monetários em numeric.
- Exclusão lógica com deleted_at.
- Arquivamento separado de exclusão.
- created_at, updated_at e version quando necessário.
- Auditoria append-only.

### Supabase

Supabase será o provedor inicial de PostgreSQL, Auth e Storage por reduzir infraestrutura no MVP. O domínio não dependerá de APIs específicas do provedor.

O acesso ao banco ocorre pela API e pelo worker. O frontend usa Supabase somente no fluxo de autenticação; não acessa tabelas financeiras diretamente.

## 8. Autenticação e autorização

Supabase Auth fornece e-mail e senha, confirmação, recuperação, sessões e MFA TOTP.

O 2FA por e-mail será um mecanismo de step-up implementado pela aplicação mediante códigos curtos, uso único, hash persistido, expiração e limitação de tentativas. TOTP permanece a opção recomendada.

A API valida tokens, resolve o usuário e executa autorização em cada caso de uso. RLS funciona como defesa adicional quando aplicável, nunca como único controle.

## 9. Filas e processamento assíncrono

pg-boss usa o próprio PostgreSQL e evita Redis adicional no MVP.

Filas iniciais:

- import.parse;
- import.ocr;
- export.generate;
- email.send;
- projection.materialize;
- retention.cleanup;
- audit.verify.

Jobs devem possuir idempotência, retry limitado, backoff e dead-letter queue. A criação do job pode participar da mesma transação do caso de uso.

## 10. Importação, OCR e arquivos

- OFX: parser dedicado.
- CSV: parser streaming com mapeamento.
- XLSX: ExcelJS.
- JSON: schema versionado.
- PDF digital: extração no worker.
- PDF escaneado: Tesseract OCR no worker.

Arquivos de importação são temporários e eliminados após processamento. Anexos persistentes usam storage compatível com S3, URLs assinadas, validação de tipo real e limite de tamanho.

## 11. Testes

- Vitest para domínio, aplicação e componentes.
- Testcontainers para PostgreSQL real.
- Playwright para ponta a ponta em Chromium e WebKit, com Edge quando necessário.
- axe-core para acessibilidade automatizada.
- Testes baseados em propriedades para invariantes.
- Testes de mutação nos cálculos críticos quando a base estiver estável.

## 12. Observabilidade

- Logs JSON estruturados com Pino.
- correlation_id por requisição e job.
- OpenTelemetry para traces e métricas do backend.
- Health checks de API, worker, banco, fila e storage.
- Alertas sem valores financeiros ou dados pessoais.
- Adaptador para provedor de erros.

Instrumentação completa do navegador fica adiada; no frontend, coletar apenas erros e Web Vitals sem conteúdo financeiro.

## 13. Entrega e infraestrutura

Docker Compose executa o ambiente local. GitHub Actions executa instalação imutável, lint, tipos, testes, contrato OpenAPI, build, smoke E2E e análises de dependências e segredos.

A arquitetura deve funcionar em qualquer provedor que ofereça runtime Node.js ou container OCI, PostgreSQL, storage S3, SMTP e HTTPS.

O provedor de web, API e worker será escolhido antes do primeiro deploy após conferir limites gratuitos vigentes. Não será introduzida dependência proprietária no domínio.

## 14. Rejeitados no MVP

- microserviços;
- GraphQL;
- event sourcing como modelo principal;
- CQRS distribuído;
- Redis obrigatório;
- Kubernetes;
- NoSQL como fonte financeira;
- escrita direta do navegador no banco;
- cálculos monetários com number;
- processamento financeiro offline;
- integração capaz de iniciar transações reais.

## 15. Referências

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [NestJS com Fastify](https://docs.nestjs.com/techniques/performance)
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [Prisma com PostgreSQL](https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql)
- [Prisma Transactions](https://www.prisma.io/docs/orm/fundamentals/transactions)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Playwright](https://playwright.dev/docs/best-practices)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
