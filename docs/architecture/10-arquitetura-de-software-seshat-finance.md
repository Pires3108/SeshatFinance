# Seshat Finance — Arquitetura de software

## 1. Direção

A Seshat Finance será um monólito modular com três processos implantáveis: web, API e worker.

API e worker compartilham módulos de domínio e aplicação, mas executam separadamente para impedir que OCR, importações e exportações prejudiquem requisições interativas.

Um módulo somente vira serviço independente quando houver evidência de escala, isolamento ou ritmo de mudança que justifique o custo.

## 2. Contexto

### Atores

- Usuário individual.
- Participante de grupo familiar em fase posterior.
- Suporte sem acesso direto a dados financeiros.
- Provedores de autenticação, e-mail, storage e observabilidade.

### Sistemas externos

- Supabase Auth.
- PostgreSQL gerenciado.
- Storage compatível com S3.
- SMTP.
- Provedor de observabilidade.
- Fontes de cotação somente leitura em fase posterior.

Não existe integração com permissão de pagamento, transferência, bloqueio, resgate, aporte ou negociação.

## 3. Containers

### Web

Next.js entrega a PWA, renderiza a interface, coordena autenticação visual e consome a API.

### API

NestJS/Fastify expõe REST e OpenAPI e executa autenticação, autorização, casos de uso síncronos, invariantes, transações, idempotência, auditoria e criação de jobs.

### Worker

Node.js consome pg-boss e executa importação, OCR, exportações, e-mails, retenção e tarefas demoradas.

### PostgreSQL

Armazena dados transacionais, auditoria e filas. É a fonte de verdade.

### Object Storage

Armazena anexos persistentes e exportações temporárias. Extratos originais são eliminados após processamento.

## 4. Dependências internas

    Presentation
        ↓
    Application
        ↓
    Domain

    Infrastructure implementa portas de Application

- Domain não conhece framework ou infraestrutura.
- Application conhece Domain e define portas.
- Infrastructure implementa portas.
- Presentation traduz HTTP e jobs para casos de uso.
- Controladores não acessam Prisma diretamente.
- Repositories não contêm regra financeira.

## 5. Repositório

    SeshatFinance/
      AGENTS.md
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
      docs/
        architecture/
        requirements/
        decisions/
        testing/
      .agents/
        skills/
      .codex/
        agents/
      tooling/
      docker/

AGENTS.md adicionais podem existir em pastas que necessitem de regras específicas.

## 6. Módulos

- Identity: perfil, preferências, sessões, 2FA e eliminação.
- Households: grupos, convites, papéis e compartilhamento; fase posterior.
- Accounts: contas, saldos, moedas, arquivo e conciliação.
- Classifications: categorias, subcategorias, etiquetas e centros de custo.
- Counterparties: pessoas, empresas e instituições.
- Transactions: receitas, despesas, ajustes, transferências representativas, reembolsos e empréstimos.
- Cards: cartões, ciclos, faturas, parcelas, juros, créditos, estornos e quitações declaradas.
- Goals: metas, reservas, contribuições e progresso.
- Investments: posições, eventos, custo, valor atual e rentabilidade manual.
- Forecasts: recorrências, eventos, cenários e conversão idempotente.
- Imports: lotes, staging, mapeamento, duplicidades, confirmação e reversão.
- Exports: seleção autorizada, geração e expiração.
- Notifications: gatilhos, preferências e central interna.
- Audit: eventos append-only e consulta autorizada.

## 7. Fluxo de escrita

1. Autenticar.
2. Resolver ator e escopo.
3. Validar schema.
4. Carregar agregados.
5. Autorizar ação.
6. Executar invariantes.
7. Persistir em transação.
8. Registrar auditoria.
9. Criar job ou outbox quando necessário.
10. Retornar representação segura.

Operações críticas exigem idempotency_key vinculada ao usuário, ação e payload normalizado.

## 8. Fluxo de leitura

Consultas simples usam repositories otimizados. Painéis e relatórios podem usar queries próprias e views materializadas sem atravessar agregados, desde que permaneçam somente leitura, respeitem autorização, não redefinam regras de saldo e possuam testes de reconciliação.

Não haverá banco analítico separado no MVP.

## 9. Integridade e concorrência

- Foreign keys e check constraints.
- Unique constraints para idempotência e pares.
- Locks otimistas por version quando necessário.
- Transações para operações compostas.
- Locks de linha ou serializable apenas quando necessário.
- Jobs idempotentes com tentativas registradas.
- Outbox transacional quando houver processamento assíncrono garantido.

## 10. Importação

Fluxo:

1. upload temporário;
2. validação;
3. criação do lote;
4. parsing ou OCR;
5. normalização em staging;
6. detecção de duplicidades;
7. revisão;
8. confirmação transacional;
9. criação de registros e auditoria;
10. eliminação do original.

Reversão:

1. carregar lote;
2. verificar dependências;
3. bloquear quando houver vínculos posteriores;
4. retirar logicamente todos os registros em uma transação;
5. recalcular derivados;
6. auditar.

## 11. Projeções

Recorrências e parcelas futuras geram ocorrências projetadas, nunca movimentações realizadas. O worker pode materializar projeções por até 12 meses, mas a fonte permanece sendo a regra original.

A conversão exige declaração do usuário, usa formulário editável e idempotência, vincula origem e registro efetivado e não executa ação externa.

## 12. Segurança

### Fronteiras

- Navegador é não confiável.
- API valida tudo.
- Worker valida payloads.
- Storage usa URLs assinadas.
- Banco não é público para operações financeiras.
- Segredos usam armazenamento protegido.

### Autorização

Uma policy central combina identidade, ownership, household_id, visibilidade da conta, papel, capability e estado. Controladores não implementam autorização dispersa.

### Privacidade

- Dados sensíveis mascarados.
- Logs sem conteúdo financeiro.
- Anexos privados.
- Exportações temporárias.
- Suporte sem consulta ao domínio.
- Eliminação e retenção auditáveis.

## 13. Observabilidade

Cada requisição e job recebe correlation_id. Monitorar latência, erro, filas, importação, exportação, e-mail, pool de conexões, backup, idempotência e falhas de autorização.

Valores, descrições, entidades, números de conta e anexos não entram na telemetria.

## 14. Deploy

- Web: build Next.js independente.
- API: container OCI stateless.
- Worker: container OCI com concorrência por fila.
- Dados: PostgreSQL e storage gerenciados.
- Migrações: etapa única controlada antes da troca da aplicação.
- Ambientes: desenvolvimento, homologação e produção.
- Evolução de schema: expand-and-contract.
- Módulos futuros: feature flags.

## 15. Evolução

Manter monólito modular enquanto uma equipe pequena desenvolver o produto, o banco único atender desempenho, módulos compartilharem transações e deploy conjunto não for gargalo.

O processamento documental é o primeiro candidato natural à extração se OCR e importações exigirem escala própria. O núcleo financeiro deve permanecer coeso enquanto depender de transações compartilhadas.

## 16. Conformidade

Uma implementação está alinhada quando:

- regras financeiras residem no domínio;
- API é a única porta de escrita;
- operações compostas são atômicas;
- dinheiro não usa number;
- importações passam por staging;
- jobs são idempotentes;
- nenhum componente executa transações externas;
- módulos não atravessam repositories;
- contratos HTTP são documentados;
- invariantes afetadas têm testes.
