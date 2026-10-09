# Seshat Finance — Regras de negócio

## 1. Princípios do domínio

- **RN-001:** a Seshat Finance é um sistema exclusivamente organizacional; nenhum registro inicia, agenda, autoriza, confirma perante terceiros, impede, bloqueia, cancela ou altera uma transação financeira real.
- **RN-002:** todo valor monetário deve ter moeda explícita e precisão compatível com ela. Novos registros financeiros usam inicialmente BRL, USD ou EUR com duas casas; valor e moeda originais não são reescritos por cotação manual ou informativa.
- **RN-003:** patrimônio líquido corresponde a ativos menos obrigações; transferências internas não o alteram.
- **RN-004:** saldo disponível, dinheiro guardado, saldo investido, dívidas e patrimônio líquido são métricas distintas.
- **RN-005:** registros arquivados continuam no histórico; registros na lixeira deixam de compor saldos e indicadores.

## 2. Contas e movimentações

- **RN-006:** receita aumenta o saldo da conta de destino.
- **RN-007:** despesa reduz o saldo da conta de origem, exceto compra no cartão, que aumenta a obrigação da fatura.
- **RN-008:** o registro de uma transferência declarada pelo usuário cria dois lançamentos inseparáveis, negativo na origem e positivo no destino, sem transmitir ordem a qualquer instituição.
- **RN-009:** edição ou restauração de um lado da transferência afeta o par completo.
- **RN-010:** ajuste exige justificativa e registra saldo anterior, saldo informado e diferença.
- **RN-011:** reembolso vinculado reduz o gasto líquido da despesa original, sem apagar lançamentos.
- **RN-012:** movimentações mantêm histórico de criação, alteração, arquivamento, restauração e exclusão lógica.
- **RN-013:** uma movimentação aceita uma categoria, uma subcategoria pertencente à categoria, um centro de custo e várias etiquetas.
- **RN-014:** entidade é opcional e alterações posteriores não reescrevem silenciosamente o histórico.

## 3. Cartões, faturas e parcelas

- **RN-015:** a despesa é reconhecida na compra, não no pagamento da fatura.
- **RN-016:** após declaração do usuário, o registro de pagamento de fatura reduz saldo organizacional da conta pagadora e obrigação do cartão sem criar nova despesa nem efetuar pagamento externo.
- **RN-017:** o limite organizacional estimado diminui na compra registrada e aumenta na quitação ou estorno registrados, sem bloquear ou liberar limite real.
- **RN-018:** o principal é distribuído entre parcelas; diferença de arredondamento fica na última.
- **RN-019:** juros são calculados pelo método escolhido e exibidos separadamente do principal.
- **RN-020:** juros simples usam juros = principal × taxa × períodos; compostos usam montante = principal × (1 + taxa)^períodos.
- **RN-021:** antes da confirmação, mostrar total financiado, juros, total final, valor e vencimento das parcelas.
- **RN-022:** a fatura é fechada manualmente após notificação da data prevista.
- **RN-023:** pagamento parcial mantém obrigação remanescente; juros e multa dependem de configuração explícita.
- **RN-024:** fatura vencida e não liquidada fica vermelha; proximidade do vencimento usa atenção não dependente só de cor.

## 4. Recorrências e projeções

- **RN-025:** recorrências nunca geram registros efetivados sem declaração do usuário e jamais executam a ocorrência fora da plataforma.
- **RN-026:** projeções usam apenas dados cadastrados; não inferem consumo pelo histórico na primeira versão.
- **RN-027:** conversão de evento projetado é idempotente e não pode gerar duas movimentações.
- **RN-028:** evento opcional vencido é arquivado após 14 dias; obrigação vencida permanece pendente e notificável.
- **RN-029:** cada cenário é cópia independente e não altera dados reais ou outros cenários.
- **RN-030:** o horizonte máximo apresentado é de 12 meses.

## 5. Metas, reservas e investimentos

- **RN-031:** reserva integra o patrimônio, mas não o saldo disponível.
- **RN-032:** contribuição pode ser dividida entre metas, mas a soma não supera a movimentação.
- **RN-033:** meta não movimenta saldo por si só; apenas movimentações vinculadas contam como contribuição.
- **RN-034:** investimento integra saldo investido e patrimônio pelo valor atual informado; custo e valor atual permanecem separados.
- **RN-035:** aportes e resgates declarados entre conta e investimento são representados como transferências internas; rendimentos e dividendos declarados são receitas. Nenhum deles é executado pela Seshat Finance.
- **RN-036:** atualização automática futura registra fonte, instante da cotação e correção manual.
- **RN-037:** posição em moeda estrangeira é consolidada em BRL por cotação manual, mantendo valor e moeda originais.

## 6. Importação e exportação

- **RN-038:** nenhuma linha importada afeta dados reais antes da confirmação.
- **RN-039:** duplicidade é suspeita, não exclusão automática; a decisão cabe ao usuário.
- **RN-040:** cada item importado mantém vínculo com o lote após edição.
- **RN-041:** reversão de lote é integral e atômica.
- **RN-042:** edição descritiva não bloqueia reversão; vínculo financeiro, conciliação, transferência, reembolso, parcela, meta ou referência externa bloqueia.
- **RN-043:** reversão retira movimentações dos saldos e preserva auditoria.
- **RN-044:** o arquivo original não é retido; metadados e resultados do lote são.
- **RN-045:** exportações incluem somente dados autorizados ao solicitante.

## 7. Exclusão, retenção e grupos

- **RN-046:** exclusão comum é lógica e reversível por 30 dias.
- **RN-047:** registros com dependências não podem ser purgados até remoção das dependências ou anonimização.
- **RN-048:** na eliminação da conta, o acesso é bloqueado imediatamente, dados ativos são apagados ou anonimizados em até 24 horas e backups expiram em até 14 dias.
- **RN-049:** conta individual é invisível aos demais membros, inclusive administradores e proprietário.
- **RN-050:** o proprietário não pode ser removido; transfere a propriedade antes de sair.
- **RN-051:** administrador gere membros e outros administradores, mas não remove nem rebaixa o proprietário.
- **RN-052:** membro opera dados compartilhados sem gerir o grupo; observador tem somente leitura.
- **RN-053:** remoção do grupo revoga acesso imediatamente e preserva autoria histórica.

## 8. Notificações e segurança

- **RN-054:** notificações financeiras são configuráveis; avisos de segurança não podem ser totalmente desativados.
- **RN-055:** a central interna não envia alertas do sistema operacional na primeira versão.
- **RN-056:** dados sensíveis permanecem mascarados por padrão.
- **RN-057:** ações destrutivas exigem confirmação proporcional; eliminação de conta exige reautenticação.
