# Seshat Finance — Critérios de aceitação

## 1. Objetivo

Os critérios validam as jornadas críticas sem repetir cada requisito funcional. Cada cenário referencia os requisitos e regras que deve comprovar.

## 2. Cenários

### CA-001 — Cadastro e autenticação

**Dado** um e-mail ainda não cadastrado, **quando** o usuário concluir cadastro e confirmação, **então** poderá entrar com e-mail e senha. Cinco falhas consecutivas devem aplicar bloqueio temporário sem revelar se a conta existe.  
**Referências:** RF-001 a RF-005; RNF-024 a RNF-028.

### CA-002 — Segundo fator

**Dado** usuário autenticado, **quando** ativar TOTP ou código por e-mail e confirmar o desafio, **então** logins seguintes exigirão o segundo fator; a desativação exigirá reautenticação.  
**Referências:** RF-004; RNF-028.

### CA-003 — Conta e saldo

**Dado** usuário autenticado, **quando** cadastrar conta válida com saldo inicial, **então** ela aparecerá na lista e o consolidado será atualizado exatamente uma vez.  
**Dado** o catálogo padrão de tipos de conta, **quando** consultá-lo, **então** os tipos previstos em RF-016 serão apresentados em português sem impedir chaves personalizadas.
**Referências:** RF-015 a RF-020; RN-002 a RN-005.

### CA-004 — Receita e despesa

**Dado** uma conta ativa, **quando** registrar receita e despesa, **então** o saldo será aumentado e reduzido, respectivamente, e os registros aparecerão nas visões temporais.  
**Referências:** RF-026, RF-027, RF-030, RF-067 a RF-069; RN-006, RN-007.

### CA-005 — Transferência

**Dado** duas contas do usuário, **quando** ele registrar uma transferência ocorrida fora da Seshat Finance, **então** origem e destino organizacionais serão atualizados atomicamente, o patrimônio permanecerá igual e nenhuma ordem será enviada a terceiros.  
**Dado** uma transferência registrada, **quando** seu proprietário consultar a lista ou o detalhe, **então** verá o par de lançamentos e seu estado; outro usuário não terá acesso.
**Referências:** RF-028; RN-003, RN-008, RN-009; RNF-049.

### CA-006 — Ajuste

**Dado** divergência de saldo, **quando** justificar e confirmar a conciliação, **então** será criado ajuste pela diferença e o histórico guardará ambos os saldos.  
**Referências:** RF-019, RF-029; RN-010.

### CA-007 — Exclusão e restauração

**Dado** movimentação válida, **quando** for à lixeira, **então** deixará de afetar saldos; **quando** restaurada, voltará a afetá-los uma única vez.  
**Dado** o filtro explícito de lixeira, **quando** consultar movimentações, **então** apenas registros do usuário naquele estado serão retornados, sem alterar a consulta sem filtro.
**Referências:** RF-032, RF-090; RN-005, RN-046, RN-047.

### CA-008 — Cartão e fatura

**Dado** cartão vinculado, **quando** uma compra for registrada, **então** despesa e obrigação organizacionais aumentarão sem reduzir a conta pagadora; **quando** o usuário declarar o pagamento feito externamente, obrigação e saldo diminuirão sem duplicar a despesa ou iniciar pagamento.  
**Referências:** RF-038, RF-039, RF-043 a RF-045; RN-015 a RN-017.

### CA-009 — Parcelamento

**Dado** principal, quantidade, taxa, periodicidade e método, **quando** visualizar a prévia, **então** serão mostrados principal, juros, total e parcelas; após confirmar, a soma das parcelas será igual ao total.  
**Referências:** RF-040 a RF-042; RN-018 a RN-021; RNF-047.

### CA-010 — Recorrência

**Dado** recorrência ativa, **quando** uma ocorrência entrar no horizonte, **então** aparecerá somente na projeção; apenas a declaração explícita de que ocorreu fora da Seshat Finance criará um registro efetivado.  
**Referências:** RF-036, RF-037, RF-057 a RF-060; RN-025 a RN-027.

### CA-011 — Obrigação vencida

**Dado** evento futuro obrigatório, **quando** vencer sem confirmação, **então** permanecerá ativo, vermelho com rótulo textual e notificável; evento opcional seguirá arquivamento.  
**Referências:** RF-061, RF-063, RF-086; RN-028; RNF-044.

### CA-012 — Cenários

**Dado** uma projeção, **quando** criar e alterar cenário, **então** dados reais e demais cenários permanecerão inalterados.  
**Referências:** RF-062; RN-029.

### CA-013 — Metas

**Dado** transferência elegível, **quando** distribuir seu valor entre metas, **então** a soma não excederá a transferência e o progresso será atualizado.  
**Referências:** RF-047 a RF-050; RN-031 a RN-033.

### CA-014 — Investimento manual

**Dado** investimento e eventos, **quando** informar valor atual, **então** posição, custo, rentabilidade e saldo investido serão recalculados e o patrimônio usará o valor atual.  
**Referências:** RF-051 a RF-055; RN-034, RN-035.

### CA-015 — Importação

**Dado** arquivo suportado, **quando** for processado, **então** nenhuma linha afetará saldos antes da confirmação; erros, mapeamentos e duplicidades serão exibidos.  
**Referências:** RF-074 a RF-079; RN-038 a RN-040.

### CA-016 — Reversão

**Dado** lote sem dependências, **quando** revertido, **então** todas as movimentações serão retiradas atomicamente; havendo dependências, nenhuma será revertida e os bloqueios serão listados.  
**Referências:** RF-080; RN-041 a RN-044; RNF-049.

### CA-017 — Exportação

**Dado** filtros e formato, **quando** a exportação terminar, **então** conterá apenas dados autorizados e filtrados, com datas brasileiras, valores precisos e UTF-8.  
**Referências:** RF-081 a RF-084; RN-045.

### CA-018 — Pesquisa e painel

**Dado** histórico financeiro, **quando** pesquisar, ordenar ou filtrar, **então** resultados e totais refletirão a seleção; o painel separará saldos, dívidas e patrimônio.  
**Referências:** RF-064 a RF-073; RN-003 a RN-005.

### CA-019 — Família

**Dado** grupo com os quatro papéis, **quando** cada participante operar dados, **então** a matriz será aplicada no servidor, contas individuais ficarão invisíveis e a autoria será preservada.  
**Referências:** RF-009 a RF-014; RN-049 a RN-053; RNF-029.

**Dado** um participante ativo, **quando** seu papel for alterado, **então** o servidor verificará o papel atual do autor e do participante na mesma transação da mudança, impedirá a alteração direta do proprietário e registrará autor, papéis anterior e novo e instante em auditoria imutável.

**Referências:** RF-010; RN-050 a RN-052; INV-039; INV-041.

### CA-020 — Eliminação

**Dado** usuário reautenticado, **quando** confirmar duas vezes, **então** o acesso será bloqueado imediatamente, dados ativos serão eliminados ou anonimizados em 24 horas e backups expirarão em 14 dias.  
**Referências:** RF-007, RF-008; RN-048; RNF-034 a RNF-039.

### CA-021 — Acessibilidade

**Dado** usuário usando teclado e tecnologia assistiva, **quando** executar jornadas críticas, **então** foco, rótulos, erros, estados e confirmações atenderão WCAG 2.2 AA.  
**Referências:** RNF-041 a RNF-046.

### CA-022 — Desempenho

**Dado** volume dentro do baseline, **quando** executar testes representativos, **então** ao menos 95% das operações atenderão RNF-006 a RNF-011.  
**Referências:** RNF-006 a RNF-012.

### CA-023 — Backup

**Dado** backup diário, **quando** ocorrer teste trimestral, **então** dados consistentes serão recuperados dentro do RPO e RTO.  
**Referências:** RNF-015 a RNF-019.

### CA-024 — Precisão

**Dado** valores, moedas e operações pareadas, **quando** cálculos forem repetidos, **então** resultados serão determinísticos, reconciliáveis e sem erro de ponto flutuante.  
**Referências:** RNF-047 a RNF-052.
