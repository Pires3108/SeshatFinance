# Seshat Finance — Requisitos funcionais

## 1. Objetivo

Este documento define as capacidades funcionais da Seshat Finance, uma aplicação pessoal de organização financeira. A plataforma não movimenta dinheiro real, não executa ordens de investimento e não opera contas bancárias. Ela somente registra, organiza, importa, projeta e apresenta informações declaradas pelo usuário.

## 2. Escopo da primeira versão

A primeira versão será uma aplicação web responsiva e instalável como PWA, voltada prioritariamente a desktop. Ela funcionará on-line, em português do Brasil, com BRL como moeda de apresentação principal e suporte a registros em outras moedas. O compartilhamento familiar e a atualização automática de investimentos ficam planejados para fases posteriores, mas o modelo de dados deve permitir sua inclusão.

## 3. Convenções

- Obrigatório: integra a primeira versão.
- Posterior: foi definido, mas não integra a primeira entrega.
- Exclusão de registros financeiros significa exclusão lógica e recuperável, salvo a eliminação da conta do usuário prevista na LGPD.
- Valores monetários devem usar precisão decimal, sem cálculo financeiro com ponto flutuante binário.

## 3.1 Limite operacional absoluto

- A Seshat Finance não inicia, agenda, autoriza, confirma, cancela, impede ou altera transações em bancos, corretoras, carteiras digitais, cartões ou qualquer sistema externo.
- A Seshat Finance não bloqueia saldo, cartão, conta, compra, pagamento, transferência, saque, aporte ou resgate real.
- Botões como “confirmar pagamento”, “transferência”, “aporte” ou “resgate” registram exclusivamente a declaração do usuário de que o evento ocorreu fora da plataforma.
- Saldos, limites, faturas, alertas e estados mostrados pela Seshat Finance são representações organizacionais e não comandam nem garantem a situação real nas instituições.
- Nenhuma integração futura poderá ampliar esse escopo sem revisão explícita destes requisitos.

## 4. Requisitos

### 4.1 Identidade e acesso

- **RF-001 — Cadastro:** permitir cadastro com nome, e-mail confirmado e senha.
- **RF-002 — Autenticação:** permitir entrada com e-mail e senha e saída explícita da sessão.
- **RF-003 — Recuperação:** permitir redefinir senha por link de uso único enviado ao e-mail cadastrado, sem revelar se o endereço existe.
- **RF-004 — Segundo fator:** permitir ativar, confirmar, desativar e recuperar 2FA por aplicativo autenticador TOTP ou código por e-mail.
- **RF-005 — Sessões:** mostrar sessões ativas e permitir encerrá-las individualmente ou em conjunto.
- **RF-006 — Perfil:** permitir consultar e atualizar nome, preferências, moeda de apresentação e configurações de notificação.
- **RF-007 — Eliminação da conta:** permitir solicitar eliminação da conta mediante confirmação dupla e novo desafio de autenticação; exigir 2FA quando estiver ativo.
- **RF-008 — Portabilidade:** permitir exportar os dados pessoais e financeiros do usuário antes da eliminação.

### 4.2 Grupos familiares — fase posterior

- **RF-009 — Grupo familiar:** permitir criar grupo, convidar e remover participantes.
- **RF-010 — Papéis:** suportar Proprietário, Administrador, Membro e Observador.
- **RF-011 — Privacidade:** manter contas individuais invisíveis aos demais participantes e permitir contas compartilhadas.
- **RF-012 — Titularidade:** permitir mais de um titular em conta compartilhada.
- **RF-013 — Autoria:** identificar o participante que criou ou alterou um registro compartilhado.
- **RF-014 — Saída:** revogar imediatamente o acesso compartilhado quando um participante sair ou for removido, preservando a auditoria.

### 4.3 Contas e saldos

- **RF-015 — Cadastro de conta:** criar conta com nome, descrição, instituição, tipo, agência opcional, número mascarado opcional, moeda, saldo inicial, cor, ícone, status e data de criação.
- **RF-016 — Tipos de conta:** suportar conta corrente, poupança, carteira em dinheiro, reserva, cartão de crédito, conta de investimento e outros tipos configuráveis.
- **RF-017 — CRUD de conta:** consultar, editar, arquivar, restaurar e enviar contas para a lixeira sem apagar seu histórico.
- **RF-018 — Saldo:** calcular saldo contábil a partir do saldo inicial e das movimentações válidas.
- **RF-019 — Conciliação:** permitir informar saldo real, calcular a diferença e criar ajuste positivo ou negativo com justificativa e saldo anterior registrado.
- **RF-020 — Multimoeda:** registrar contas e movimentações em moedas distintas, mantendo BRL como moeda principal de apresentação. O catálogo inicial para novos registros é BRL, USD e EUR, com duas casas decimais. Cotação manual mantém par, taxa decimal textual, vigência, origem, autor e histórico imutável de correções; registro e correção usam chave de idempotência. Nenhuma cotação altera saldo ou lançamento original. Consolidação convertida permanece indisponível até a aprovação das regras contábeis de conversão, precedência e arredondamento.

### 4.4 Classificação e entidades

- **RF-021 — Categorias:** fornecer categorias iniciais e CRUD completo de categorias e subcategorias.
- **RF-022 — Etiquetas:** permitir várias etiquetas por movimentação e CRUD completo delas.
- **RF-023 — Centros de custo:** permitir um centro de custo por movimentação e CRUD completo.
- **RF-024 — Entidades:** permitir cadastrar pessoas, empresas e instituições com nome, tipo, documento opcional, e-mail opcional, telefone opcional, observações e status.
- **RF-025 — Vínculos:** vincular uma entidade a movimentações, empréstimos e instituições sem exigir seu cadastro.

### 4.5 Movimentações

- **RF-026 — Receita:** registrar receitas de renda ativa, renda passiva ou investimento, recebimento informal, reembolso ou estorno e recebimento de empréstimo.
- **RF-027 — Despesa:** registrar despesas essenciais ou fixas, variáveis ou de estilo de vida, envio informal e concessão de empréstimo.
- **RF-028 — Registro de transferência:** representar uma transferência já realizada ou planejada fora da Seshat Finance por lançamentos pareados, sem iniciar a operação externa nem alterar o patrimônio líquido consolidado.
- **RF-029 — Ajuste:** registrar ajuste de saldo positivo ou negativo, sempre com justificativa.
- **RF-030 — Campos:** toda movimentação deve conter conta, tipo, valor, moeda, data e hora; pode conter entidade, descrição, categoria, subcategoria, etiquetas, centro de custo e observações.
- **RF-031 — Edição:** permitir editar movimentações, recalcular os saldos afetados e manter histórico de valores anteriores e novos.
- **RF-032 — Exclusão lógica:** enviar movimentação para a lixeira, removendo seu efeito dos saldos e permitindo restauração.
- **RF-033 — Anexos:** anexar comprovantes em PDF, JPG, PNG ou WebP, com pré-visualização e remoção controlada.
- **RF-034 — Reembolso:** vincular reembolso ou estorno à despesa original e apresentar o valor líquido.
- **RF-035 — Empréstimos:** controlar credor ou devedor, principal, parcelas, vencimentos, saldo pendente, pagamentos parciais e situação.
- **RF-036 — Recorrência:** cadastrar recorrências diárias, semanais, quinzenais, mensais, anuais ou personalizadas, com início, fim ou quantidade de ocorrências e pausa.
- **RF-037 — Recorrência projetada:** gerar ocorrências apenas na projeção; uma ocorrência só se torna registro efetivado após o usuário declarar que aconteceu fora da plataforma.

### 4.6 Cartões e faturas

- **RF-038 — Cartão vinculado:** cadastrar cartão de crédito vinculado a uma conta de pagamento, com bandeira, nome, limite, fechamento e vencimento.
- **RF-039 — Compra no cartão:** reconhecer a despesa na data da compra e aumentar a obrigação da fatura, sem reduzir imediatamente o saldo da conta de pagamento.
- **RF-040 — Parcelamento:** dividir o principal nas parcelas configuradas, registrar a parcela atual como compromisso da fatura e projetar as futuras.
- **RF-041 — Juros:** calcular juros simples ou compostos conforme taxa e periodicidade informadas, exibir memória de cálculo e garantir que a soma das parcelas corresponda ao total.
- **RF-042 — Gestão de parcelas:** permitir antecipação, renegociação e alteração organizacional de parcelas, mantendo auditoria.
- **RF-043 — Fatura:** agrupar compras, créditos, estornos, juros, multas e pagamentos; permitir fechamento manual e avisar quando a data configurada chegar.
- **RF-044 — Registro de pagamento da fatura:** após o usuário declarar que pagou a fatura fora da Seshat Finance, representar a redução da obrigação e do saldo da conta escolhida, sem iniciar o pagamento nem registrar uma segunda despesa.
- **RF-045 — Pagamento parcial:** manter saldo remanescente, permitir juros e multas informados pelo usuário e refletir a dívida no patrimônio.
- **RF-046 — Estados visuais:** destacar fatura próxima do vencimento e mostrar em vermelho somente a fatura vencida e não liquidada.

### 4.7 Reservas e metas

- **RF-047 — Meta:** criar meta com nome, valor-alvo, prazo opcional, contas associadas e valor inicial.
- **RF-048 — Contribuições:** vincular registros de transferências a uma ou mais metas, distribuindo valores explicitamente.
- **RF-049 — Progresso:** apresentar valor acumulado, valor restante, percentual e situação da meta.
- **RF-050 — Reserva:** classificar contas ou saldos como reserva e separá-los do saldo disponível sem retirá-los do patrimônio.

### 4.8 Investimentos

- **RF-051 — Cadastro manual:** registrar Tesouro Direto, CDB, LCI, LCA, poupança, ações, FIIs, ETFs, criptomoedas, fundos e previdência privada.
- **RF-052 — Dados do investimento:** registrar instituição, ativo, código, moeda, quantidade, preço médio, aportes, resgates, vencimento, indexador, taxa, impostos, liquidez e data inicial.
- **RF-053 — Eventos:** registrar manualmente aportes, resgates, rendimentos, dividendos, juros, taxas e impostos.
- **RF-054 — Indicadores:** calcular posição, custo, valor informado atual, rentabilidade nominal e percentual, renda recebida e tempo de aplicação.
- **RF-055 — Consolidação:** apresentar investimentos separadamente como saldo investido e incluí-los no patrimônio líquido.
- **RF-056 — Atualização automática — posterior:** obter cotações, eventos e rentabilidade de fontes externas a definir, preservando correção manual e origem do dado.

### 4.9 Projeções e cenários

- **RF-057 — Horizonte:** projetar saldo e compromissos por até 12 meses.
- **RF-058 — Fontes:** usar somente recorrências, parcelas, metas e eventos futuros explicitamente cadastrados, sem inferir hábitos pelo histórico.
- **RF-059 — Evento futuro:** cadastrar possível receita ou despesa com os mesmos campos essenciais de um registro efetivado.
- **RF-060 — Confirmação organizacional:** após o usuário declarar que o evento aconteceu fora da plataforma, convertê-lo em registro efetivado por formulário pré-preenchido e editável, sem duplicidade.
- **RF-061 — Vencimento:** arquivar visualmente eventos opcionais vencidos; manter obrigações vencidas visíveis em vermelho e com notificações até resolução.
- **RF-062 — Cenários:** criar cenários como cópias independentes da projeção e permitir alternar entre eles sem alterar dados reais.
- **RF-063 — Gerenciamento:** permitir restaurar, reagendar, descartar e consultar eventos futuros arquivados.

### 4.10 Visões, pesquisa e relatórios

- **RF-064 — Visão geral:** exibir saldo disponível, dinheiro guardado, saldo investido, dívidas e patrimônio líquido separadamente.
- **RF-065 — Indicadores:** exibir receitas, despesas, gastos parcelados, fatura atual, orçamento e variação contra o período anterior.
- **RF-066 — Gráficos:** apresentar saldo, investimentos e gastos por mês ou ano, com filtros por conta, categoria e período.
- **RF-067 — Visão diária:** listar movimentações do dia em ordem temporal e permitir trocar ou selecionar a data.
- **RF-068 — Visão semanal:** listar movimentações da semana por dia e hora e permitir trocar ou selecionar a semana.
- **RF-069 — Visão mensal:** listar movimentações do mês por data e hora e permitir trocar ou selecionar o mês.
- **RF-070 — Pesquisa global:** localizar ferramentas, páginas, contas, movimentações, entidades, metas e investimentos.
- **RF-071 — Ordenação e filtros:** ordenar por data ou valor e combinar filtros por período, conta, tipo, categoria, entidade, dívida, parcela e assinatura.
- **RF-072 — Orçamentos:** criar limites por período e categoria, conta ou centro de custo, comparando planejado e realizado.
- **RF-073 — Relatórios:** gerar relatórios filtrados para visualização e impressão em PDF.

### 4.11 Importação

- **RF-074 — Formatos:** importar OFX, CSV, XLSX, JSON e PDF digital ou escaneado com OCR.
- **RF-075 — Instituições iniciais:** oferecer modelos para Inter, Nubank e Mercado Pago, abrangendo conta, cartão e investimento quando o extrato fornecer tais dados.
- **RF-076 — Mapeamento:** permitir mapear colunas e campos não reconhecidos e salvar modelos de mapeamento.
- **RF-077 — Prévia:** validar e permitir edição de todas as linhas antes da confirmação.
- **RF-078 — Duplicidades:** detectar por combinação de identificador externo, conta, data, valor, descrição e entidade; em caso de dúvida, pedir decisão entre manter existente, importar nova ou manter ambas.
- **RF-079 — Lote:** vincular cada movimentação criada ao lote e registrar nome do arquivo, formato, data, autor, totais, erros e identificadores, sem conservar o arquivo original.
- **RF-080 — Reversão:** reverter atomicamente um lote quando suas movimentações não tiverem dependências posteriores; caso existam, listar os bloqueios.

### 4.12 Exportação

- **RF-081 — Formatos:** exportar CSV, XLSX e JSON, além de PDF para relatórios.
- **RF-082 — Escopo:** permitir selecionar período, contas, categorias, entidades e tipos de dado, incluindo configurações, metas, projeções e histórico quando solicitado.
- **RF-083 — Localidade:** exportar datas no padrão brasileiro e CSV separado por vírgula com codificação UTF-8 e cabeçalho.
- **RF-084 — XLSX:** permitir tabela única por padrão ou abas separadas por entidade conforme preferência.

### 4.13 Notificações, auditoria e recuperação

- **RF-085 — Central interna:** apresentar notificações somente dentro da aplicação, com ligação para a página e o registro relacionados.
- **RF-086 — Gatilhos:** notificar saldo negativo, fechamento e vencimento de fatura, obrigação futura vencida e meta com prazo próximo.
- **RF-087 — Preferências:** permitir ativar ou desativar tipos de notificação, sem desativar avisos críticos de segurança.
- **RF-088 — Auditoria:** registrar autenticação, alterações financeiras, importações, exportações, permissões e exclusões com autor, data, ação e valores relevantes.
- **RF-089 — Histórico:** permitir ao usuário consultar o histórico de seus dados e, em grupo, permitir consulta conforme papel.
- **RF-090 — Lixeira:** permitir consultar, restaurar ou eliminar definitivamente itens elegíveis após confirmação reforçada.

## 5. Fora do escopo da primeira versão

- Integração operacional com bancos, corretoras, carteiras, cartões ou sistemas de pagamento.
- Iniciação, autorização, bloqueio, cancelamento ou impedimento de transações externas.
- Execução de ordens ou custódia de investimentos.
- Atualização automática de mercado.
- Aplicativos nativos para Windows, macOS, Android ou iOS.
- Uso funcional sem internet, além de uma página informativa de indisponibilidade.
- Notificações do sistema operacional, navegador, SMS ou mensageria externa.
