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

### RII-008 — Semântica pública de restauração de conta

- **Estado:** aberto.
- **Referências:** RF-017; RN-005; INV-009; INV-010.
- **Risco:** “restaurar” não distingue reativação de conta arquivada de recuperação da lixeira, o que pode alterar indevidamente sua participação nas listas e indicadores.
- **Decisão necessária:** definir os rótulos e fluxos públicos para desarquivar e restaurar da lixeira.
- **Limite atual:** o domínio mantém comandos distintos e, ao restaurar da lixeira, recupera o estado ativo ou arquivado preservado antes da remoção lógica.

### RII-009 — Captura e armazenamento de número de conta mascarado

- **Estado:** aberto.
- **Referências:** RF-015; RNF-023; RNF-031; princípio de minimização.
- **Risco:** o requisito não define se a API deve receber o número completo, somente os últimos dígitos ou uma máscara já pronta; receber ou persistir o valor bruto ampliaria desnecessariamente o dado financeiro sensível.
- **Decisão necessária:** definir o formato de entrada, a máscara canônica, a quantidade de dígitos preservados e se existe necessidade de armazenamento cifrado reversível.
- **Limite atual:** o campo não integra contratos nem persistência até a decisão; nenhuma API deve aceitar número de conta bruto.

### RII-010 — Catálogo inicial e exclusão de classificações

- **Estado:** aberto.
- **Referências:** RF-021 a RF-023; RN-013; US-025 a US-027.
- **Risco:** os requisitos não enumeram as categorias iniciais, não definem se o catálogo é global ou copiado por usuário e não determinam o efeito de excluir uma categoria, subcategoria, etiqueta ou centro de custo já utilizado. Inferir essas escolhas pode apagar referências históricas, impedir personalização ou tornar futuras atualizações do catálogo incompatíveis.
- **Decisão necessária:** aprovar o catálogo inicial versionado, seu modelo de ownership e personalização, além das regras de arquivamento, restauração e exclusão para classificações referenciadas.
- **Limite atual:** permitir evoluir o núcleo de categorias com ownership e hierarquia validada, mas não publicar seed inicial nem exclusão destrutiva até a decisão. Referências históricas nunca devem ser removidas em cascata.

### RII-011 — Estado e preservação histórica de entidades

- **Estado:** aberto.
- **Referências:** RF-024; RF-025; RN-014; US-028.
- **Risco:** o cadastro de pessoas, empresas e instituições exige um status, mas os requisitos não definem os estados permitidos, o estado inicial, as transições nem o efeito de desativar uma entidade já vinculada. Inferir essas regras pode ocultar vínculos válidos ou reescrever a interpretação do histórico financeiro.
- **Decisão necessária:** definir a máquina de estados pública das entidades, incluindo criação, desativação, reativação, exclusão e comportamento nas consultas e vínculos históricos.
- **Limite atual:** não implementar persistência nem contratos públicos de entidade até a decisão. Vínculos opcionais por texto ou referência futura não devem exigir cadastro, e alterações cadastrais nunca devem reescrever silenciosamente o histórico.

## 3. Itens resolvidos

Mover um item para esta seção somente com evidência verificável, preservando o identificador e registrando commit, teste ou documento que o resolveu.

### RII-002 — Exposição HTTP do perfil antes da identidade autenticada

- **Estado:** resolvido.
- **Referências:** RF-006; US-009; US-016; US-017.
- **Evidência:** o guard Bearer resolve o ator no provedor de identidade; os endpoints `GET` e `PATCH /api/v1/users/me/profile` derivam o identificador exclusivamente desse ator e possuem testes contra seleção pelo navegador.
- **Decisão aplicada:** nenhum identificador de usuário faz parte do corpo ou dos parâmetros públicos do perfil.
