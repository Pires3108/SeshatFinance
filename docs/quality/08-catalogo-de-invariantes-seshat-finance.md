# Seshat Finance — Catálogo de invariantes financeiras

## 1. Objetivo

Invariantes são propriedades que devem permanecer verdadeiras independentemente da interface, ordem das ações, volume de dados ou implementação. Este catálogo transforma as regras críticas da Seshat Finance em condições verificáveis.

Todas as invariantes P0 devem possuir testes automatizados unitários e de integração. Quando envolverem uma jornada, devem possuir ao menos um teste ponta a ponta.

## 2. Limite operacional

### INV-001 — Nenhuma execução financeira externa

A Seshat Finance nunca inicia, agenda, autoriza, impede, bloqueia, cancela ou altera transações em sistemas externos.

**Verificação:** a aplicação não possui endpoints operacionais, escopos de escrita, certificados transacionais ou credenciais de pagamento. Ações de interface apenas gravam representações internas.

**Referências:** limite operacional; RN-001.

### INV-002 — Confirmação é declaração

Confirmar pagamento, transferência, aporte ou resgate significa declarar que o evento ocorreu fora da plataforma.

**Verificação:** textos e contratos internos não prometem execução; confirmar gera somente registros organizacionais e auditoria.

**Referências:** RF-028, RF-044, RF-060; RN-008, RN-016, RN-035.

## 3. Precisão monetária

### INV-003 — Ausência de ponto flutuante binário

Valores monetários persistidos e calculados usam decimal ou unidades inteiras da menor fração da moeda.

**Verificação:** casos como 0,1 + 0,2 produzem exatamente 0,3 na precisão aplicável.

**Referências:** RNF-047.

### INV-004 — Moeda explícita

Todo valor financeiro possui uma moeda associada; valores de moedas diferentes nunca são somados sem conversão explícita.

**Referências:** RF-020; RN-002, RN-037.

### INV-005 — Arredondamento reconciliável

Diferenças de arredondamento de parcelas são atribuídas à última parcela, e a soma permanece igual ao total.

**Verificação:** testar divisões inexatas positivas, negativas e com juros.

**Referências:** RN-018; CA-009.

## 4. Saldos e patrimônio

### INV-006 — Equação do saldo de conta

Saldo contábil é igual ao saldo inicial mais receitas, entradas pareadas e ajustes positivos, menos despesas, saídas pareadas e ajustes negativos, considerando apenas registros ativos.

**Referências:** RF-018; RN-005 a RN-010.

### INV-007 — Transferência preserva patrimônio

O registro pareado de transferência altera as contas envolvidas pelo mesmo valor convertido e não altera o patrimônio consolidado, salvo tarifa, imposto ou diferença cambial registrados separadamente.

**Verificação:** sucesso, edição, restauração e falha parcial.

**Referências:** RF-028; RN-003, RN-008, RN-009; CA-005.

### INV-008 — Transferência é atômica

Os dois lados do registro de transferência existem juntos ou não existem.

**Verificação:** interromper a operação entre os lançamentos e comprovar rollback.

**Referências:** RN-008, RN-009; RNF-049.

### INV-009 — Lixeira não compõe saldo

Registro enviado à lixeira deixa de afetar saldo, patrimônio, orçamento e gráficos. Ao ser restaurado, volta a afetá-los exatamente uma vez.

**Referências:** RF-032, RF-090; RN-005, RN-046; CA-007.

### INV-010 — Arquivo preserva efeito histórico

Arquivar conta ou movimentação não remove seu efeito dos períodos em que esteve válida.

**Referências:** RF-017; RN-005; RNF-055.

### INV-011 — Ajuste fecha a diferença

Após ajuste, o saldo calculado deve ser igual ao saldo real informado, e diferença, saldo anterior e justificativa devem permanecer auditáveis.

**Referências:** RF-019, RF-029; RN-010; CA-006.

### INV-012 — Patrimônio líquido

Patrimônio líquido é igual aos ativos organizacionais menos obrigações, sem dupla contagem de reservas ou investimentos.

**Referências:** RF-064; RN-003, RN-004, RN-031, RN-034.

### INV-013 — Reserva não é saldo disponível

Reserva integra o patrimônio, mas não o saldo disponível.

**Referências:** RF-050; RN-031.

## 5. Cartões e faturas

### INV-014 — Compra reconhecida uma vez

Compra no cartão cria uma despesa e uma obrigação da fatura, mas não reduz a conta pagadora naquele momento.

**Referências:** RF-039; RN-007, RN-015; CA-008.

### INV-015 — Quitação não duplica despesa

Registrar o pagamento externo da fatura reduz a conta pagadora e a obrigação, sem criar nova despesa no resultado.

**Referências:** RF-044; RN-016; CA-008.

### INV-016 — Limite é estimativa organizacional

O limite exibido reage a compras, estornos e quitações registrados, mas nunca bloqueia ou libera limite real.

**Referências:** RF-038, RF-046; RN-017.

### INV-017 — Fatura reconciliável

Total da fatura é igual a compras e acréscimos menos créditos, estornos e quitações aplicáveis ao ciclo.

**Referências:** RF-043 a RF-045; RN-022 a RN-024.

### INV-018 — Pagamento parcial preserva dívida

Quitação parcial nunca marca a fatura como totalmente quitada enquanto houver saldo remanescente.

**Referências:** RF-045; RN-023.

### INV-019 — Parcelas fecham o total

Soma do principal distribuído e dos juros aplicáveis é igual ao total apresentado antes da confirmação.

**Referências:** RF-040, RF-041; RN-018 a RN-021; CA-009.

## 6. Projeções e recorrências

### INV-020 — Projeção não altera realidade organizacional

Evento projetado não altera saldo atual, fatura realizada, orçamento realizado ou patrimônio atual.

**Referências:** RF-037, RF-057 a RF-063; RN-025, RN-026.

### INV-021 — Conversão única

Um evento futuro pode originar no máximo um registro efetivado.

**Verificação:** repetição de clique, retry de rede e chamadas concorrentes retornam o mesmo resultado sem duplicidade.

**Referências:** RF-060; RN-027; RNF-049.

### INV-022 — Cenários são isolados

Alterar um cenário não altera dados reais, a projeção-base ou outro cenário.

**Referências:** RF-062; RN-029; CA-012.

### INV-023 — Horizonte limitado

A projeção apresentada não inclui ocorrências além de 12 meses da data de referência.

**Referências:** RF-057; RN-030.

### INV-024 — Obrigação vencida permanece pendente

Obrigação vencida não é arquivada como evento opcional e permanece visível até confirmação, reagendamento ou descarte explícito permitido pela regra.

**Referências:** RF-061, RF-063; RN-028; CA-011.

## 7. Metas e investimentos

### INV-025 — Alocação de meta não excede origem

A soma das contribuições de uma movimentação entre metas não supera o valor elegível da movimentação.

**Referências:** RF-048; RN-032; CA-013.

### INV-026 — Meta não cria dinheiro

Criar ou editar uma meta não altera saldo ou patrimônio.

**Referências:** RF-047 a RF-050; RN-033.

### INV-027 — Aporte e resgate não alteram patrimônio por si

Registros de aporte e resgate entre conta e investimento reclassificam ativos; taxas, impostos, ganhos ou perdas são registrados separadamente.

**Referências:** RF-051 a RF-055; RN-034, RN-035.

### INV-028 — Valor atual e custo não se confundem

Custo acumulado, valor atual e renda recebida permanecem grandezas separadas.

**Referências:** RF-052 a RF-055; RN-034.

### INV-029 — Conversão preserva origem

Cotação manual conserva par de moedas, taxa decimal textual, origem, autor, vigência e versões anteriores. Repetir o mesmo comando não cria versão ou auditoria adicional. Quando houver consolidação em BRL aprovada, ela conservará valor original, moeda, cotação e data de referência; antes disso, não existe soma entre moedas distintas.

**Referências:** RF-020; RN-037.

## 8. Importação e exportação

### INV-030 — Prévia é neutra

Processar ou editar uma prévia de importação não altera saldo nem cria registros efetivados.

**Referências:** RF-077; RN-038; CA-015.

### INV-031 — Duplicidade não é descartada automaticamente

Suspeita de duplicidade exige decisão do usuário e mantém evidência dos registros comparados.

**Referências:** RF-078; RN-039.

### INV-032 — Vínculo de lote é permanente

Movimentação importada mantém identificação do lote mesmo após edição.

**Referências:** RF-079; RN-040.

### INV-033 — Reversão é atômica

Reversão remove logicamente todas as movimentações elegíveis do lote ou nenhuma.

**Referências:** RF-080; RN-041 a RN-043; CA-016.

### INV-034 — Dependência impede reversão

Lote com vínculo financeiro posterior não pode ser revertido até resolução das dependências.

**Referências:** RF-080; RN-042; CA-016.

### INV-035 — Exportação respeita autorização

Arquivo exportado contém somente dados visíveis ao solicitante no momento da geração.

**Referências:** RF-081 a RF-084; RN-045; CA-017.

## 9. Autorização e privacidade

### INV-036 — Isolamento entre usuários

Um usuário nunca consulta ou altera dados individuais de outro por alteração de URL, identificador, filtro, exportação ou chamada direta à API.

**Referências:** RNF-029; CA-019.

### INV-037 — Conta individual permanece privada

Em grupo familiar, conta individual é invisível até para proprietário e administradores.

**Referências:** RF-011; RN-049.

### INV-038 — Observador não modifica

O papel Observador não executa nenhuma operação de criação, alteração, importação, exportação ou exclusão em dados compartilhados.

**Referências:** RF-010; RN-052; matriz de permissões.

### INV-039 — Proprietário não fica ausente

O grupo sempre possui exatamente um proprietário ativo; ele transfere a propriedade antes de sair.

**Referências:** RN-050, RN-051.

### INV-040 — Remoção revoga acesso

Ao remover um participante, seus acessos ao grupo são invalidados imediatamente, inclusive em sessões já abertas.

**Referências:** RF-014; RN-053.

## 10. Auditoria, retenção e recuperação

### INV-041 — Auditoria acompanha ação crítica

Autenticação, alteração financeira, importação, exportação, permissão, exclusão e restauração geram evento de auditoria com autor e instante.

**Referências:** RF-088, RF-089; RNF-032.

### INV-042 — Auditoria não contém segredo

Logs nunca guardam senha, código 2FA, token completo, conteúdo integral de anexo ou credencial.

**Referências:** RNF-032.

### INV-043 — Eliminação bloqueia acesso imediatamente

Após confirmação da eliminação da conta, nenhuma nova sessão ou operação do usuário é permitida.

**Referências:** RF-007; RN-048; RNF-036.

### INV-044 — Retenção segue o estado

Histórico arquivado permanece enquanto a conta existir; lixeira comum retém por 30 dias; projeção opcional vencida segue 14 dias para arquivo e três meses de retenção.

**Referências:** RNF-055 a RNF-058.

### INV-045 — Backup restaurado é consistente

Uma restauração não pode produzir apenas um lado de transferência, fatura sem itens, lote sem vínculos ou referência órfã.

**Referências:** RNF-015 a RNF-018; CA-023.

## 11. Estratégias de automação

### Testes por exemplo

Usar valores conhecidos para juros, parcelas, faturas, câmbio, datas e retenção.

### Testes parametrizados

Executar as mesmas regras sobre diferentes moedas, sinais, quantidades de parcelas, datas e estados.

### Testes baseados em propriedades

Gerar combinações válidas e comprovar invariantes como:

- transferência preserva patrimônio;
- ida à lixeira seguida de restauração retorna ao estado inicial;
- soma das parcelas equivale ao total;
- exportar e reimportar formato compatível preserva valores;
- repetir comando idempotente não duplica registros.

### Testes de mutação

Aplicar principalmente aos cálculos de saldo, juros, parcelas e autorização para comprovar que a suíte detecta mudanças indevidas nas regras.

### Testes de concorrência

Simular cliques repetidos, retries, duas sessões e filas concorrentes em conversão de projeção, transferências, quitação e reversão.

## 12. Critério de adoção

Uma invariante P0 somente é considerada implementada quando:

1. possui teste unitário quando aplicável;
2. possui teste de integração com persistência;
3. possui teste de concorrência quando houver risco de duplicidade;
4. está vinculada ao requisito e regra;
5. falha no pipeline quando violada;
6. possui evidência de caso normal e caso de limite.
