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

### RII-005 — Persistência e expiração da sessão web

- **Estado:** aberto.
- **Referências:** RF-002; RF-005; RNF-026; RNF-027; US-014; US-016.
- **Risco:** retornar tokens ao JavaScript ou aceitar apenas a expiração padrão do Supabase não comprova cookies HttpOnly, 30 minutos de inatividade nem o máximo absoluto de 12 horas.
- **Decisão necessária:** definir se a API manterá uma sessão opaca própria ou um envelope de refresh token no servidor, incluindo revogação, rotação, inatividade e múltiplos dispositivos.
- **Limite atual:** autenticação e tradução da sessão ficam isoladas no adaptador; nenhum endpoint de login ou cookie é publicado até essa estratégia preservar todos os requisitos.

### RII-006 — Política progressiva de limitação de autenticação

- **Estado:** aberto.
- **Referências:** RNF-025; US-014; US-018.
- **Risco:** embora o bloqueio após cinco falhas esteja definido, não há duração inicial, progressão, janela de recuperação nem divisão de responsabilidade entre API e Supabase; inferir esses parâmetros pode bloquear usuários legítimos ou oferecer proteção apenas aparente.
- **Decisão necessária:** definir as janelas e durações progressivas, as chaves de origem consideradas e qual camada manterá o estado compartilhado entre instâncias.
- **Limite atual:** não publicar login nem afirmar a conclusão do rate limit; testes de cadastro, recuperação e resolução de ator continuam independentes.

### RII-007 — Catálogo monetário e política de arredondamento

- **Estado:** aberto.
- **Referências:** RN-002; RNF-047; US-021; US-022; INV-003 a INV-005.
- **Risco:** os documentos exigem precisão compatível com a moeda e arredondamento explícito, mas não definem o catálogo de moedas suportadas, a fonte das casas decimais nem os modos de arredondamento por operação.
- **Decisão necessária:** aprovar o catálogo versionado de moedas e a matriz de arredondamento para conversões, rateios, juros e apresentação.
- **Limite atual:** `Currency` exige código e escala explícitos, e `Money` aceita apenas valores exatamente representáveis nessa escala; operações que exigem arredondamento não serão adicionadas antes da decisão.

## 3. Itens resolvidos

Mover um item para esta seção somente com evidência verificável, preservando o identificador e registrando commit, teste ou documento que o resolveu.

### RII-002 — Exposição HTTP do perfil antes da identidade autenticada

- **Estado:** resolvido.
- **Referências:** RF-006; US-009; US-016; US-017.
- **Evidência:** o guard Bearer resolve o ator no provedor de identidade; os endpoints `GET` e `PATCH /api/v1/users/me/profile` derivam o identificador exclusivamente desse ator e possuem testes contra seleção pelo navegador.
- **Decisão aplicada:** nenhum identificador de usuário faz parte do corpo ou dos parâmetros públicos do perfil.
