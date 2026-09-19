# Seshat Finance — Registro de riscos e inferências de implementação

## 1. Objetivo

Este registro preserva decisões que não podem ser inferidas com segurança durante a execução do backlog. Um item aberto não interrompe histórias independentes; ele bloqueia somente o comportamento diretamente afetado.

## 2. Itens abertos

### RII-001 — Provedor de implantação

- **Estado:** aberto.
- **Referências:** ADR-011; US-099.
- **Risco:** escolher um provedor antes de verificar limites, portabilidade e requisitos operacionais criaria dependência prematura.
- **Limite atual:** manter web, API e worker portáveis; não configurar produção nem credenciais de provedor.
- **Decisão necessária:** selecionar o provedor antes do primeiro deploy, com custos e limites vigentes documentados.

### RII-002 — Exposição HTTP do perfil antes da identidade autenticada

- **Estado:** aberto até US-016.
- **Referências:** RF-006; US-009; US-016; US-017.
- **Risco:** aceitar um identificador de usuário fornecido pelo navegador permitiria autorização horizontal indevida.
- **Limite atual:** o caso de uso e a persistência do perfil podem ser implementados e testados, mas o endpoint público deve aguardar o resolvedor de ator autenticado.
- **Decisão necessária:** nenhuma decisão de produto; concluir o adaptador de autenticação e o resolvedor de ator previstos na Sprint 2.

### RII-003 — Validação local da migration PostgreSQL

- **Estado:** pendente por ambiente local.
- **Referências:** US-003; US-007; US-011.
- **Risco:** considerar a migration comprovada apenas pela validação estática do Prisma deixaria incompatibilidades reais sem teste.
- **Limite atual:** o schema passa em `prisma validate`, mas migration e seed não contam como verificados até rodarem no PostgreSQL isolado do Compose.
- **Condição de resolução:** iniciar o Docker Desktop, subir o serviço `postgres` e executar migration, seed e teste de integração sem usar outra instância local.

### RII-004 — Política de senha do cadastro

- **Estado:** aberto.
- **Referências:** RF-001; RNF-024; CA-001; US-013.
- **Risco:** os requisitos delegam o armazenamento seguro ao provedor de identidade, mas não definem comprimento mínimo, composição, verificação contra senhas comprometidas ou mensagens de orientação.
- **Decisão necessária:** definir a política no Supabase Auth e refletir a mesma orientação na interface, sem manter uma segunda política divergente na API.
- **Limite atual:** a API valida somente presença e limites estruturais; o provedor aplica a política efetiva até a decisão ser registrada.

## 3. Itens resolvidos

Mover um item para esta seção somente com evidência verificável, preservando o identificador e registrando commit, teste ou documento que o resolveu.
