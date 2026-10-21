# Seshat Finance — Convenções e padrões de desenvolvimento

## 1. Objetivo

Este documento define nomenclatura, organização, práticas de implementação e critérios mínimos de qualidade. As regras valem para código humano e gerado por agentes.

Quando uma regra precisar ser quebrada, a mudança deve registrar o motivo no código, pull request ou ADR. Preferência pessoal não é justificativa.

## 2. Idiomas

- Código, identificadores, banco, API, mensagens internas, logs e commits: inglês.
- Interface e mensagens apresentadas ao usuário: português do Brasil.
- Documentação funcional e de produto: português do Brasil.
- Documentação de APIs e comentários técnicos: inglês, salvo quando explicar uma regra de negócio originalmente definida em português.
- Termos de domínio devem possuir um glossário e uma tradução oficial. Não misturar termos equivalentes como account e wallet para a mesma entidade.

## 3. Nomenclatura geral

### Arquivos e diretórios

- Diretórios: kebab-case.
- Arquivos TypeScript e TSX: kebab-case.
- Componentes React: arquivo kebab-case e símbolo PascalCase.
- Testes unitários: nome-do-alvo.spec.ts.
- Testes de integração: nome-do-fluxo.integration.spec.ts.
- Testes ponta a ponta: nome-da-jornada.e2e.spec.ts.
- Migrations: timestamp_descricao_em_snake_case.
- ADRs: NNNN-titulo-em-kebab-case.md.
- Skills: nome em kebab-case e arquivo principal SKILL.md.

Exemplos:

    account-balance-card.tsx
    calculate-statement-total.spec.ts
    import-bank-statement.integration.spec.ts
    0007_add_transaction_idempotency_key

### Símbolos TypeScript

- Variáveis, funções e propriedades: camelCase.
- Classes, tipos, interfaces e componentes: PascalCase.
- Constantes realmente globais e imutáveis: UPPER_SNAKE_CASE.
- Booleanos: prefixos is, has, can, should ou was.
- Coleções: substantivo no plural.
- Funções: verbo explícito.
- Handlers: handle seguido do evento.
- Factories: create ou build.
- Parsers: parse; validações sem conversão: validate.

Evitar:

- abreviações não universais;
- nomes genéricos como data, info, item, manager, helper e utils;
- sufixo Impl;
- letras isoladas fora de índices locais;
- repetição do contexto já expresso pelo módulo.

### Tipos e contratos

- Entidades: Account, Transaction, Statement.
- Objetos de valor: Money, Currency, InterestRate.
- Casos de uso: CreateAccountUseCase.
- Comandos internos: CreateAccountCommand.
- Resultados: CreateAccountResult.
- Portas: AccountRepository, FileStorage, EmailSender.
- Adaptadores: PrismaAccountRepository, SupabaseFileStorage.
- DTO de entrada HTTP: CreateAccountRequestDto.
- DTO de saída HTTP: AccountResponseDto.
- Eventos: TransactionCreated, StatementClosed; sempre no passado.
- Erros de domínio: InvalidInstallmentPlanError.
- Códigos de erro públicos: INVALID_INSTALLMENT_PLAN.

Não criar prefixos I para interfaces.

### Banco de dados

- Tabelas e colunas: snake_case.
- Tabelas: plural.
- Chave primária: id.
- Foreign key: entidade no singular seguida de _id.
- Instantes: sufixo _at.
- Datas civis: sufixo _date quando necessário.
- Booleanos: prefixo is_ ou has_.
- Valores monetários: amount e currency_code; nomes mais específicos quando houver múltiplos valores.
- Exclusão lógica: deleted_at.
- Arquivamento: archived_at.
- Concorrência otimista: version.
- Constraints e índices: tipo_tabela_colunas.

Exemplos:

    transactions
    account_id
    occurred_at
    due_date
    is_shared
    uq_transactions_idempotency_key
    idx_transactions_account_id_occurred_at
    ck_installments_positive_amount

### API

- Recursos: substantivos plurais em kebab-case.
- JSON: camelCase.
- Query parameters: camelCase.
- Versão: /api/v1.
- Identificador no caminho: /accounts/{accountId}.
- Ações que não são CRUD natural: sub-recurso ou verbo explícito somente quando inevitável.

Exemplos:

    POST /api/v1/accounts
    GET /api/v1/accounts/{accountId}
    POST /api/v1/import-batches/{batchId}/confirmations
    POST /api/v1/forecast-events/{eventId}/realizations

## 4. Organização e dependências

### Camadas

- domain não importa frameworks, ORM, HTTP ou storage.
- application importa domain e define portas.
- infrastructure implementa portas.
- presentation chama casos de uso.
- apps compõem dependências.

### Módulos

- Um módulo não acessa tabela ou repository interno de outro módulo.
- Comunicação síncrona ocorre por caso de uso ou porta pública.
- Comunicação assíncrona ocorre por evento ou job documentado.
- Código compartilhado só vai para packages quando possuir mais de um consumidor real.
- Não criar pasta utils global.
- Dependência circular é erro de arquitetura.

### Tamanho e responsabilidade

- Função deve fazer uma operação reconhecível.
- Classe deve possuir uma responsabilidade central.
- Arquivos extensos devem ser divididos por conceito, não por limite mecânico de linhas.
- Não extrair abstração antes de existir duplicação semântica ou variação real.

## 5. TypeScript

- strict, noUncheckedIndexedAccess e exactOptionalPropertyTypes são obrigatórios.
- any é proibido; exceção exige comentário e isolamento na fronteira.
- unknown é usado para entrada não confiável e deve ser refinado.
- Preferir type para unions e composição; interface para contratos extensíveis.
- Não usar enum do TypeScript; preferir objeto as const e union derivada.
- Não usar non-null assertion sem prova local documentada.
- Não ignorar Promise.
- Funções públicas declaram retorno.
- Switch sobre union discriminada deve ser exaustivo.
- Erros capturados são unknown.
- Imports devem usar aliases definidos e não atravessar internals de outro package.

## 6. Dinheiro, taxas e datas

### Dinheiro

- number é proibido para valores monetários, taxas acumuladas ou quantidades que exijam precisão.
- Money contém amount Decimal e currency.
- Soma e comparação exigem a mesma moeda.
- Conversão exige ExchangeRate, moedas de origem e destino e data de referência.
- Arredondamento ocorre em ponto explícito e testado.
- Formatação monetária pertence à apresentação.
- Nunca persistir valor formatado.

### Juros

- Taxa sempre declara período e método.
- Juros simples e compostos são operações distintas.
- Prévia e persistência usam o mesmo serviço de domínio.
- Total, principal, juros e parcelas devem reconciliar.

### Datas

- Instantes persistidos em UTC.
- Datas civis usam tipo próprio ou string ISO YYYY-MM-DD, sem conversão acidental de fuso.
- Fuso do usuário é aplicado apenas na apresentação ou em regra que o exija.
- Relógio deve ser injetável; não chamar new Date diretamente no domínio.
- Recorrências devem testar fim de mês, fevereiro, ano bissexto e mudança de ano.

## 7. Erros

- Erros de domínio descrevem violação de regra.
- Erros de aplicação descrevem falha de caso de uso.
- Erros de infraestrutura são traduzidos antes de subir de camada.
- API usa envelope de erro consistente com code, message, correlationId e details seguros.
- Mensagem pública não expõe stack, SQL, caminho interno ou existência de conta.
- Não capturar erro para ignorá-lo.
- Retry ocorre apenas para falhas transitórias e operações idempotentes.

## 8. Logs e auditoria

- Logs estruturados em JSON.
- Toda requisição e job possui correlationId.
- Campos comuns: timestamp, level, service, environment, correlationId, event e errorCode.
- Não registrar valores financeiros, descrições de transações, nomes de entidades, números de conta, tokens, códigos 2FA ou anexos.
- Logs técnicos e auditoria de negócio são mecanismos separados.
- Auditoria é append-only e registra ator, ação, recurso, instante e alterações permitidas.

## 9. Frontend

- Server Component por padrão; Client Component somente quando houver interação ou API do navegador.
- Componente visual não chama repository nem contém regra financeira.
- Data fetching passa pelo cliente gerado da API.
- TanStack Query gerencia estado remoto.
- React Hook Form e Zod gerenciam formulários.
- Estado local fica próximo do uso.
- Não duplicar valor derivável em estado.
- Componentes devem aceitar navegação por teclado e nomes acessíveis.
- Cor nunca é o único indicador.
- Todo gráfico possui alternativa textual ou tabular.
- Estados loading, empty, error, forbidden e success devem ser explícitos.
- Valores financeiros sensíveis não são persistidos em localStorage.

## 10. API

- Controlador é fino: mapeia entrada, chama caso de uso e mapeia saída.
- Toda entrada externa é validada.
- Autorização ocorre no servidor.
- Escritas críticas aceitam idempotency key.
- Paginação usa cursor para listas grandes.
- Filtros e ordenação usam allowlist.
- Endpoints não retornam modelo Prisma.
- OpenAPI é gerado e verificado no CI.
- Mudança incompatível exige nova versão ou estratégia compatível.
- Datas usam ISO 8601; valores decimais são serializados como strings.

## 11. Banco e migrações

- Toda alteração de schema possui migration revisável.
- Migration aplicada nunca é editada; cria-se uma nova.
- Produção usa expand-and-contract para mudanças incompatíveis.
- Adicionar coluna obrigatória: criar nullable, preencher, validar e então restringir.
- Toda foreign key define comportamento de exclusão conscientemente.
- Índice deve corresponder a consulta real.
- Constraint protege invariantes simples no banco.
- Seed nunca contém dados pessoais reais.
- Migração deve ter plano de rollback ou explicação de irreversibilidade.
- A aplicação não depende de ordem implícita de registros.

## 12. Filas e jobs

- Nome da fila usa domínio.ação em lowercase.
- Payload possui schema e version.
- Job possui chave de idempotência.
- Retry usa limite, backoff e classificação de erro.
- Falha permanente vai para dead-letter.
- Handler pode ser executado mais de uma vez sem duplicar efeito.
- Jobs não carregam dados sensíveis desnecessários; preferir IDs.
- Job longo publica progresso sem conteúdo financeiro.

## 13. Testes

- Nome descreve comportamento, não método.
- Estrutura Arrange, Act, Assert.
- Um teste falha por um motivo principal.
- Não depender da ordem de execução.
- Tempo, UUID e serviços externos são controláveis.
- Unitários cobrem domínio.
- Integração usa PostgreSQL real com Testcontainers.
- E2E testa comportamento visível, usando roles e labels.
- Toda correção de bug inclui teste de regressão.
- Mudança P0 ou P1 referencia invariantes aplicáveis.
- Snapshot não substitui asserção financeira explícita.
- Cobertura percentual é indicador; invariantes e riscos determinam suficiência.

## 14. Segurança

- Segredos nunca entram no repositório.
- Dependências novas exigem justificativa, licença compatível e análise de manutenção.
- Validar upload por conteúdo, tamanho e extensão.
- SQL manual é parametrizado.
- HTML de usuário não é renderizado sem sanitização.
- Permissões seguem menor privilégio.
- Operações sensíveis exigem reautenticação conforme requisitos.
- Nenhum código pode iniciar, autorizar, impedir, bloquear ou cancelar transações financeiras externas.

## 15. Git

### Branches

- main: sempre liberável.
- feat/descricao-curta.
- fix/descricao-curta.
- refactor/descricao-curta.
- docs/descricao-curta.
- chore/descricao-curta.

### Commits

Usar Conventional Commits em inglês:

    feat(accounts): add balance reconciliation
    fix(cards): prevent duplicated statement payment
    test(imports): cover atomic batch rollback
    docs(architecture): record queue decision

Commits devem ser pequenos, coerentes e não misturar refatoração ampla com mudança funcional.

### Pull requests

- Explicar problema, solução, riscos e testes.
- Referenciar requisitos, regras, critérios e invariantes.
- Destacar migration, variável de ambiente ou mudança de contrato.
- Incluir captura somente quando mudança visual se beneficiar.
- Não aprovar com teste crítico falhando.

## 16. Documentação

- Decisão arquitetural relevante gera ADR.
- Contrato público gera OpenAPI.
- Regra financeira nova atualiza requisitos, regras, aceitação, invariantes e testes.
- Comentário explica por quê, não repete o código.
- TODO inclui contexto rastreável e condição de remoção.
- README de package descreve responsabilidade, API pública e dependências permitidas.

## 17. Qualidade mínima

Antes de concluir uma alteração:

1. formatar;
2. executar lint;
3. verificar tipos;
4. executar testes afetados;
5. executar invariantes críticas quando aplicável;
6. conferir contrato e migration;
7. revisar segurança e privacidade;
8. atualizar documentação;
9. verificar diff final.

## 18. Definição de concluído

Uma mudança está concluída quando:

- comportamento atende aos critérios;
- limites arquiteturais foram respeitados;
- testes normais, limites e regressão foram adicionados;
- logs não expõem dados;
- acessibilidade foi verificada quando houver UI;
- OpenAPI e migrations estão atualizados;
- documentação e rastreabilidade foram ajustadas;
- pipeline obrigatório está verde.

## 19. Guardas executáveis de arquitetura — US-002

`pnpm lint` aplica `architecture/boundaries` a imports estáticos, reexports,
imports dinâmicos literais, `require` literal e imports de tipo. Caminhos relativos
são resolvidos a partir do arquivo chamador; o alias `@seshat/` também é verificado.
Domain rejeita frameworks, ORM e camadas externas. Application rejeita infraestrutura;
o browser rejeita Domain, Application e acesso ao banco. Repositories internos de
outro módulo do banco são proibidos no código de produção; módulos expõem uma API
pública. Fixtures de integração podem montar repositories para verificar persistência.

`architecture/precise-money` rejeita anotações `number` em valores monetários e taxas
identificados por seus nomes. Essa guarda complementa os tipos de `Money`, que aceitam
apenas strings decimais ou `bigint` com moeda explícita; não substitui revisão de nomes
arbitrários ou cálculos financeiros. Escalas, dias e versões continuam inteiros válidos.

`pnpm test:architecture` executa exemplos proibidos e permitidos contra o ESLint real
e compila chamadas reais de `Money` com TypeScript strict. Os diagnósticos incluem
localização. O comando faz parte de `pnpm test`, executado pela CI após checkout,
instalação com lockfile congelado e geração explícita de Prisma. A configuração de
lint, a implementação das regras e o tsconfig base invalidam o cache do Turbo.

Rastreabilidade: US-002 / SESHAT-18, RNF-047/RNF-050/RNF-054 e INV-003/INV-004.
