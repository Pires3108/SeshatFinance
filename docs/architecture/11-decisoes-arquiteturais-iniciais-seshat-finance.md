# Seshat Finance — Decisões arquiteturais iniciais

## ADR-001 — Monólito modular

**Status:** aceita.

Implementar monólito modular com web, API e worker como processos implantáveis. Isso preserva transações e reduz infraestrutura, mantendo fronteiras para evolução.

## ADR-002 — TypeScript de ponta a ponta

**Status:** aceita.

Usar TypeScript estrito no frontend, backend, worker e domínio. Dinheiro usa Decimal; number é proibido.

## ADR-003 — REST e OpenAPI

**Status:** aceita.

Usar API REST versionada com contrato OpenAPI e cliente gerado. Mudanças incompatíveis exigem versão nova ou migração compatível.

## ADR-004 — PostgreSQL

**Status:** aceita.

Armazenar dados financeiros, auditoria e filas em PostgreSQL por suas transações, numeric, constraints e portabilidade.

## ADR-005 — Prisma ORM

**Status:** aceita.

Usar Prisma para schema, migrações, Decimal, queries tipadas e transações. SQL parametrizado continua permitido para necessidades específicas.

## ADR-006 — Supabase por adaptadores

**Status:** aceita para o MVP.

Usar Supabase Auth, PostgreSQL e Storage inicialmente, isolados por interfaces. O frontend não acessa tabelas financeiras diretamente.

## ADR-007 — Filas em PostgreSQL

**Status:** aceita.

Usar pg-boss no MVP para evitar Redis e permitir job na mesma transação. Revisar quando volume justificar broker dedicado.

## ADR-008 — PWA on-line

**Status:** aceita.

Instalar como PWA, cachear shell e ativos e exigir rede para gravações. Não haverá fila financeira offline.

## ADR-009 — Nenhuma operação externa

**Status:** irrevogável sem redefinição formal do produto.

Não possuir integração ou credencial capaz de iniciar, bloquear, autorizar, impedir ou cancelar transações reais.

## ADR-010 — Observabilidade privada

**Status:** aceita.

Coletar métricas, traces e erros técnicos sem valores, descrições, entidades ou identificadores financeiros.

## ADR-011 — Provedor de deploy adiado

**Status:** pendente antes do primeiro deploy.

Manter web, API e worker portáveis e escolher provedor após verificar camadas gratuitas vigentes.

## ADR-012 — Worker documental

**Status:** aceita.

Executar parsing, OCR e exportações no worker para proteger a API. Jobs exigem idempotência, retry e dead-letter.

## ADR-013 — XLSX mínimo no Application

**Status:** aceita para US-083.

Gerar o workbook XLSX a partir do documento canônico de exportação no pacote Application,
sem dependência de produção ou acesso a storage. O serializer escreve apenas Open XML
necessário, com valores inline inertes, limites explícitos e dois layouts: abas por entidade
com `Summary` e tabela única. O endpoint, download, persistência e execução assíncrona
permanecem sob responsabilidade das histórias posteriores.
