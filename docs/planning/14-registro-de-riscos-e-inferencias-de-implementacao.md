# Seshat Finance — Registro de riscos e inferências de implementação

## 1. Objetivo

Este registro preserva decisões que não podem ser inferidas com segurança durante a execução do backlog. Um item aberto não interrompe histórias independentes; ele bloqueia somente o comportamento diretamente afetado.

## 2. Itens abertos

### RII-001 — Provedor de implantação

- **Estado:** aberto.
- **Referências:** ADR-011; US-099.
- **Risco:** escolher um provedor antes de verificar limites, portabilidade e requisitos operacionais criaria dependência prematura.
- **Limite atual:** manter web, API e worker portáveis; não configurar produção nem credenciais de provedor.
- **Evidência atual:** os previews conectados ao projeto externo `agent-waiter` executam o build do repositório com sucesso, mas falham depois por uma configuração de diretório de saída que exige `public`. Essa configuração não deve ser alterada pela aplicação sem confirmar qual artefato esse projeto deve publicar.
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
- **Interface atual:** o formulário web de cadastro replica somente esses limites estruturais; não promete nem impõe uma política de força de senha ainda não decidida.

### RII-005 — Persistência e expiração da sessão web

- **Estado:** aberto.
- **Referências:** RF-002; RF-005; RNF-026; RNF-027; US-014; US-016.
- **Risco:** retornar tokens ao JavaScript ou aceitar apenas a expiração padrão do Supabase não comprova cookies HttpOnly, 30 minutos de inatividade nem o máximo absoluto de 12 horas.
- **Decisão necessária:** definir se a API manterá uma sessão opaca própria ou um envelope de refresh token no servidor, incluindo revogação, rotação, inatividade e múltiplos dispositivos.
- **Limite atual:** autenticação e tradução da sessão ficam isoladas no adaptador; nenhum endpoint de login ou cookie é publicado até essa estratégia preservar todos os requisitos.
- **Interface atual:** o cadastro web permite solicitar a confirmação de e-mail, mas não apresenta entrada na conta nem afirma que CA-001 esteja completo.

### RII-006 — Política progressiva de limitação de autenticação

- **Estado:** aberto.
- **Referências:** RNF-025; US-014; US-018.
- **Risco:** embora o bloqueio após cinco falhas esteja definido, não há duração inicial, progressão, janela de recuperação nem divisão de responsabilidade entre API e Supabase; inferir esses parâmetros pode bloquear usuários legítimos ou oferecer proteção apenas aparente.
- **Decisão necessária:** definir as janelas e durações progressivas, as chaves de origem consideradas e qual camada manterá o estado compartilhado entre instâncias.
- **Limite atual:** não publicar login nem afirmar a conclusão do rate limit; testes de cadastro, recuperação e resolução de ator continuam independentes.

### RII-007 — Catálogo monetário e política de arredondamento

- **Estado:** aberto.
- **Referências:** RN-002; RNF-047; RF-071; US-021; US-022; US-069; INV-003 a INV-005.
- **Risco:** os documentos exigem precisão compatível com a moeda e arredondamento explícito, mas não definem o catálogo de moedas suportadas, a fonte das casas decimais nem os modos de arredondamento por operação.
- **Decisão necessária:** aprovar o catálogo versionado de moedas, a matriz de arredondamento para conversões, rateios, juros e apresentação, e a regra de comparação para ordenação por valor entre moedas diferentes.
- **Limite atual:** `Currency` exige código e escala explícitos, e `Money` aceita apenas valores exatamente representáveis nessa escala; operações que exigem arredondamento e ordenação global por valor entre moedas não serão adicionadas antes da decisão. Filtros de movimentações por conta, tipo, estado e intervalo explícito, com ordenação por data, permanecem independentes.

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

### RII-012 — Limites calendáricos das visões temporais

- **Estado:** aberto.
- **Referências:** RF-067 a RF-069; CA-004; US-030.
- **Risco:** as visões diária, semanal e mensal não definem qual fuso converte o instante da movimentação em data civil, qual dia inicia a semana nem a convenção dos limites do período. Inferir esses pontos pode omitir ou duplicar movimentações próximas à meia-noite, à mudança de mês ou a transições de horário de verão.
- **Decisão necessária:** definir o fuso autoritativo por usuário ou contexto compartilhado, o primeiro dia da semana e intervalos calendáricos semiabertos canônicos, incluindo o comportamento quando o fuso for alterado.
- **Limite atual:** consultas internas podem evoluir com intervalos explícitos de instantes `[from, to)`, ownership e ordenação determinística; endpoints ou rótulos que afirmem representar dia, semana ou mês não devem ser publicados antes da decisão.

### RII-013 — Conteúdo sensível e expiração da auditoria

- **Estado:** parcialmente aberto.
- **Referências:** RF-088; RF-089; RNF-023; RNF-032; INV-041; US-035; US-101; US-112.
- **Risco:** “valores relevantes” não define quais estados anteriores e posteriores podem ser armazenados, mascarados ou exibidos. Um payload genérico pode duplicar descrições, valores financeiros ou outros dados sensíveis e ampliar indevidamente o acesso. RNF-058 fixa retenção por 12 meses ou até a eliminação da conta, mas a exceção por investigação de segurança ainda exige uma autorização documentada e um processo operacional verificável.
- **Decisão necessária:** aprovar uma lista permitida por ação e recurso, regras de mascaramento, visibilidade por papel em contextos compartilhados e o processo de expiração ou anonimização, inclusive para a exceção de investigação de segurança.
- **Limite atual:** eventos financeiros registram somente identificador, proprietário, ator, ação, tipo e identificador do recurso e instante. Não armazenar snapshots, descrições ou valores em payload de auditoria até a decisão; implementar a expiração em US-101 e manter a consulta pública reservada para US-112.

### RII-014 — Semântica do reembolso vinculado

- **Estado:** aberto.
- **Referências:** RF-026; RF-034; RN-011; RN-042; US-036.
- **Risco:** os requisitos determinam que o reembolso ou estorno seja vinculado à despesa original e reduza seu valor líquido, mas não definem se uma despesa admite um ou vários vínculos, se os valores podem ser parciais, se o total acumulado pode superar a despesa nem quais compatibilidades de moeda e conta são obrigatórias. Também não especificam o efeito de editar, arquivar, mover para a lixeira ou restaurar qualquer um dos lançamentos. Inferir essas regras alteraria saldos e indicadores financeiros e poderia produzir vínculos inconsistentes.
- **Decisão necessária:** definir cardinalidade, limite acumulado, compatibilidade de moeda e conta, estados de ciclo de vida elegíveis e propagação de alterações, arquivamento, lixeira e restauração, além da apresentação canônica do valor líquido.
- **Limite atual:** não implementar persistência, contrato público nem cálculo de saldo ou despesa líquida para reembolsos vinculados até a decisão. Receitas comuns permanecem suportadas, mas não devem ser classificadas ou vinculadas como reembolso por inferência.

### RII-015 — Materialização do ciclo do cartão

- **Estado:** aberto.
- **Referências:** RF-038; RF-043; RN-022; RN-024; US-038; US-040; US-042.
- **Risco:** os requisitos pedem dias de fechamento e vencimento, mas não definem como materializá-los em meses que não possuem o dia configurado, se fins de semana ou feriados deslocam datas, nem como determinar o mês de vencimento quando o fechamento é posterior ao vencimento no calendário civil. Inferir essas regras pode associar compras à fatura errada, antecipar obrigações ou classificar uma fatura como vencida indevidamente.
- **Decisão necessária:** definir a regra canônica para meses curtos, a existência ou não de ajuste por dia útil, a relação mensal entre fechamento e vencimento, o fuso autoritativo e os limites inclusivos ou exclusivos usados para associar compras ao ciclo.
- **Limite atual:** o cadastro pode persistir dias civis válidos de 1 a 31 como configuração declarada pelo usuário, sem prometer uma data efetiva. Não materializar ciclos, atribuir compras a faturas, emitir alertas ou calcular atraso antes da decisão.

### RII-016 — Semântica dos dados de posição de investimento

- **Estado:** aberto.
- **Referências:** RF-051; RF-052; RN-034; RN-037; US-054 a US-057; INV-028; INV-029.
- **Risco:** quantidade, preço médio, taxa, impostos e liquidez não têm unidade, escala, periodicidade ou formato canônicos definidos. Tratar preço médio como dinheiro arredondado à menor fração da moeda, por exemplo, pode perder precisão no custo de uma posição; interpretar taxa ou imposto como percentual em vez de valor pode distorcer patrimônio e rentabilidade.
- **Decisão necessária:** definir precisão e unidade da quantidade por tipo de ativo, precisão e moeda do preço unitário, semântica e periodicidade de taxas e impostos, representação da liquidez e regras de arredondamento para custo e valor atual.
- **Limite atual:** expor somente o catálogo estável dos onze tipos previstos em RF-051. Não persistir posições nem calcular custo, rendimento ou valor atual antes da decisão.

### RII-017 — Idempotência de comandos financeiros compostos

- **Estado:** aberto; prioridade alta para US-032, US-033 e US-037.
- **Referências:** RNF-049; INV-007 a INV-011; US-032, US-033, US-037.
- **Risco:** transferências e ajustes são persistidos atomicamente, mas os casos de uso geram novos identificadores em cada requisição. Se a gravação tiver sucesso e a resposta se perder, repetir o mesmo `POST` pode criar outro par ou outro ajuste. A restrição de unicidade dos identificadores internos e o teste de duas inserções com o mesmo identificador não comprovam idempotência de tentativas HTTP distintas.
- **Decisão necessária:** definir chave de idempotência fornecida pelo cliente, escopo por proprietário e operação, prazo de retenção, comparação do conteúdo da requisição, resposta para a mesma chave com conteúdo diferente, comportamento durante execução concorrente e resposta a uma repetição depois de alterações no ciclo de vida do registro. A reserva da chave, os registros financeiros e a auditoria devem ser gravados na mesma transação.
- **Limite atual:** não afirmar que `POST /api/v1/transfers` ou `POST /api/v1/accounts/:accountId/balance-adjustments` é idempotente por requisição. Preservar a atomicidade existente e não adicionar política de repetição implícita, baseada apenas em valores ou intervalo de tempo, pois dois eventos legítimos podem ter dados iguais.

### RII-018 — Semântica de metas e reservas

- **Estado:** aberto.
- **Referências:** RF-047 a RF-050; RN-031 a RN-033; US-049 a US-053.
- **Risco:** alvo, valor inicial, contas associadas, contribuições e prazo não definem compatibilidade de moeda, cardinalidade das contas, fontes elegíveis de contribuição nem fuso do prazo. Inferir essas regras pode contar saldo duas vezes, aceitar progresso em moeda incompatível ou antecipar uma situação vencida.
- **Decisão necessária:** aprovar moeda e conversão, associação de contas, fontes e limites de contribuição, e semântica calendária do prazo e situação da meta.
- **Limite atual:** não persistir metas, contribuições, progresso ou reserva derivada até a decisão. A classificação de conta existente permanece independente e não deve ser apresentada como reserva de meta por inferência.

### RII-019 — Semântica de empréstimos e pagamentos parciais

- **Estado:** aberto.
- **Referências:** RF-035; RN-018 a RN-021; US-044 a US-047.
- **Risco:** empréstimos não definem a ordem de apropriação de pagamentos parciais entre juros e principal, tratamento de atraso, quitação antecipada, renegociação e vencimentos em meses curtos. Inferir essas regras altera saldo pendente e juros apresentados.
- **Decisão necessária:** aprovar calendário de vencimento, prioridade de alocação, regras de amortização, atraso, antecipação e situação do contrato.
- **Limite atual:** não persistir empréstimos, parcelas, saldo pendente ou pagamentos parciais até a decisão e a matriz de arredondamento do RII-007.

### RII-020 — Semântica civil das recorrências e dos eventos futuros

- **Estado:** aberto.
- **Referências:** RF-036, RF-037, RF-057 a RF-063; RN-027 a RN-030; US-059 a US-064; INV-020, INV-021, INV-023 e INV-024.
- **Risco:** as regras não definem o fuso horário autoritativo, a ancoragem de uma recorrência mensal em meses curtos, o primeiro dia da semana, a interpretação de recorrências personalizadas nem os limites inclusivos de início, fim e quantidade de ocorrências. Também não determinam se o prazo de 14 dias para arquivamento de evento opcional usa data civil ou instante. Inferir essas regras pode gerar, omitir ou arquivar projeções em datas diferentes das declaradas pelo usuário.
- **Decisão necessária:** aprovar o modelo de tempo civil, as regras de ajuste de dia inexistente, a semântica de cada frequência e recorrência personalizada, os limites de início/fim/contagem e o critério temporal para vencimento e arquivamento. A confirmação de um evento também depende da política de idempotência do RII-017.
- **Limite atual:** não persistir regras de recorrência, materializar ocorrências, calcular vencimento ou converter eventos projetados em movimentações efetivadas até a decisão. Consultas internas já existentes por intervalo explícito de instantes `[from, to)` permanecem independentes.

### RII-021 — Contrato de portabilidade e datas da exportação

- **Estado:** aberto.
- **Referências:** RF-081 a RF-084; RN-045; US-082 a US-085; INV-035.
- **Risco:** os requisitos fixam CSV UTF-8 separado por vírgula e datas no padrão brasileiro, mas não definem quais entidades e campos compõem cada exportação, a versão e a estrutura do JSON, a ordenação, a forma de representar valores monetários e nulos, nem o fuso que converte um instante em data brasileira. Inferir esse contrato pode gerar arquivos não importáveis, expor campos não autorizados ou deslocar registros no tempo.
- **Decisão necessária:** aprovar o catálogo e as versões dos conjuntos exportáveis, colunas/campos e ordenação canônicas, representação de moeda/valores/nulos, tratamento de registros arquivados e da lixeira, fuso e formato de data/hora, além do comportamento para filtros sem resultado e exportações grandes.
- **Limite atual:** não publicar endpoints nem gerar CSV, JSON, XLSX ou PDF antes da decisão. Toda futura exportação deve derivar a autorização do ator autenticado e incluir apenas dados autorizados, sem expor modelos Prisma ou arquivos privados.

### RII-022 — Convites e saída de grupos familiares

- **Estado:** aberto.
- **Referências:** RF-009, RF-014; RN-049 a RN-053; US-102 a US-105; CA-019.
- **Risco:** convite, aceite e saída não definem destinatário elegível, expiração, reenvio, revogação, limite de convites simultâneos nem o comportamento de um convite quando a identidade ainda não existe. Também não definem a experiência de saída quando a pessoa possui papéis ou registros compartilhados, além da proibição já estabelecida para o último proprietário. Inferir esses fluxos pode conceder associação à pessoa errada ou deixar acesso ativo após uma remoção.
- **Decisão necessária:** aprovar o identificador do convidado, validade e revogação do convite, regras de reenvio e aceite, transições de papéis na entrada e na saída, e a auditoria mínima permitida para esses eventos.
- **Limite atual:** implementar apenas a criação de um grupo sem metadados adicionais e a associação atômica do ator autenticado como proprietário. Não publicar convite, aceite, remoção, saída, transferência de propriedade ou contas compartilhadas até a decisão.

### RII-023 — Semântica e ciclo de vida das notificações internas

- **Estado:** aberto.
- **Referências:** RF-085 a RF-087; RN-054 a RN-056; US-086; US-087.
- **Risco:** os requisitos pedem uma central e preferências de notificações, mas não definem o catálogo e o versionamento dos tipos de alerta, seus estados de leitura, ocultação ou arquivamento, os padrões de preferência, quais avisos financeiros ou de segurança são críticos e não podem ser desativados, nem as regras de deduplicação, reemissão, retenção, mascaramento e vínculo com o evento de origem. Inferir essas regras pode silenciar um aviso crítico, duplicar alertas, reter conteúdo financeiro sensível ou apontar para um recurso que a pessoa não pode mais acessar.
- **Decisão necessária:** aprovar tipos e severidades, estados e transições, padrões de preferência, avisos obrigatórios, deduplicação e reemissão, prazo de retenção, conteúdo permitido e mascaramento, autorização para o recurso vinculado e comportamento depois de arquivar, restaurar ou remover a origem.
- **Limite atual:** não persistir central, preferências, gatilhos, contadores ou links de notificação até a decisão. A auditoria financeira append-only existente permanece independente e não deve ser usada como central de notificações por inferência.

### RII-024 — Vulnerabilidades transitivas da linha atual do Prisma

- **Estado:** aberto; prioridade alta de segurança.
- **Referências:** RNF-033; RNF-057; US-093.
- **Risco:** em 25/09/2026, `pnpm audit --prod --audit-level=high` identifica vulnerabilidades altas em `deepmerge-ts@7.1.5` e `mysql2@3.15.3`, dependências transitivas de `prisma@7.10.0` e `@prisma/client@7.10.0`. As versões corrigidas exigem, respectivamente, `deepmerge-ts >=8.0.0` e `mysql2 >=3.22.0`; a linha `@prisma/*@7` disponível permanece em 7.10.0. Forçar substituições transitivas de versão maior sem compatibilidade declarada pelo fornecedor pode quebrar geração, migração ou execução do cliente de banco.
- **Decisão necessária:** aprovar uma versão de Prisma que remova as dependências vulneráveis, ou uma exceção temporal de risco com escopo, compensações, responsável, prazo de revisão e critério de encerramento. A decisão deve considerar se o caminho vulnerável é alcançável na implantação e a compatibilidade dos adaptadores e do esquema.
- **Limite atual:** não declarar RNF-033 atendido por um gate bloqueante enquanto a auditoria alta falha. Não usar `pnpm.overrides` para elevar dependências transitivas fora da compatibilidade publicada do Prisma. Manter a evidência da auditoria e reavaliar a cada atualização de Prisma ou liberação.

## 3. Itens resolvidos

Mover um item para esta seção somente com evidência verificável, preservando o identificador e registrando commit, teste ou documento que o resolveu.

### RII-002 — Exposição HTTP do perfil antes da identidade autenticada

- **Estado:** resolvido.
- **Referências:** RF-006; US-009; US-016; US-017.
- **Evidência:** o guard Bearer resolve o ator no provedor de identidade; os endpoints `GET` e `PATCH /api/v1/users/me/profile` derivam o identificador exclusivamente desse ator e possuem testes contra seleção pelo navegador.
- **Decisão aplicada:** nenhum identificador de usuário faz parte do corpo ou dos parâmetros públicos do perfil.
