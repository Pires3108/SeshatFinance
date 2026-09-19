# Seshat Finance — Estratégia de testes

## 1. Objetivo

Este documento define como a qualidade da Seshat Finance será verificada desde o planejamento até cada liberação. A estratégia prioriza integridade dos registros financeiros, privacidade, segurança, rastreabilidade e a garantia de que a aplicação permaneça exclusivamente organizacional.

Os casos detalhados de interface serão escritos durante o refinamento das histórias. As regras críticas, invariantes e critérios de aceitação definidos nesta fase já devem orientar arquitetura, modelo de dados e implementação.

## 2. Escopo

### 2.1 Incluído

- Cadastro, autenticação, recuperação de senha, 2FA e sessões.
- Contas, saldos, receitas, despesas, ajustes e registros de transferências.
- Cartões, faturas, parcelas, juros e quitações declaradas.
- Categorias, etiquetas, centros de custo e entidades.
- Metas, reservas, investimentos e multimoeda.
- Recorrências, projeções, cenários e eventos futuros.
- Importação, detecção de duplicidades, conciliação e reversão.
- Exportação e relatórios.
- Pesquisa, painéis, filtros e notificações internas.
- Lixeira, arquivamento, auditoria, retenção e eliminação.
- Segurança, privacidade, desempenho, acessibilidade, backup e restauração.
- Permissões familiares quando essa fase entrar no desenvolvimento.

### 2.2 Fora do escopo

- Testes de iniciação de pagamento, transferência bancária, bloqueio de cartão ou execução de investimento, pois essas capacidades são proibidas.
- Homologação com sistemas transacionais de bancos ou corretoras.
- Validação de rentabilidade automática antes da definição de um provedor de dados.
- Aplicativos nativos e funcionamento off-line completo.

## 3. Princípios

- **ET-001 — Qualidade contínua:** testes são desenvolvidos junto com a funcionalidade, não acumulados para uma fase final.
- **ET-002 — Risco primeiro:** regras capazes de corromper saldo, patrimônio, fatura, parcelas ou permissões recebem prioridade máxima.
- **ET-003 — Determinismo:** o mesmo conjunto de entradas e a mesma data de referência devem produzir o mesmo resultado.
- **ET-004 — Isolamento externo:** nenhum ambiente de teste deve possuir credenciais capazes de executar transações financeiras reais.
- **ET-005 — Dados seguros:** testes não usam extratos, documentos, e-mails ou credenciais reais sem anonimização formal.
- **ET-006 — Rastreabilidade:** requisito, regra, critério de aceitação, teste automatizado e defeito devem manter referências entre si.
- **ET-007 — Automação proporcional:** testes repetitivos e críticos devem ser automatizados; avaliação exploratória permanece necessária para usabilidade e riscos emergentes.
- **ET-008 — Pirâmide saudável:** privilegiar testes unitários e de integração; reservar testes ponta a ponta para jornadas essenciais.
- **ET-009 — Reversibilidade:** exclusões lógicas, importações, migrações e operações pareadas devem ser testadas também em restauração e falha parcial.
- **ET-010 — Relógio controlado:** testes de vencimento, recorrência, fatura, retenção e fuso horário devem usar data e hora injetáveis.

## 4. Classificação de risco

### Prioridade P0 — Integridade e segurança crítica

Inclui autenticação, autorização, isolamento de contas, cálculo de saldos, transferências representativas, cartão e fatura, parcelas e juros, reversão de importação, eliminação de conta, backup e a proibição de operações externas.

Falha P0 bloqueia qualquer liberação.

### Prioridade P1 — Jornada financeira essencial

Inclui CRUD de contas e movimentações, conciliação, recorrências, projeções, investimentos manuais, metas, exportação e auditoria.

Falha P1 bloqueia a liberação quando não houver contorno seguro aprovado.

### Prioridade P2 — Experiência e análise

Inclui painéis, gráficos, pesquisa, filtros, ordenação, notificações não críticas, aparência e relatórios.

Falhas P2 podem ser aceitas temporariamente mediante registro, impacto conhecido e prazo de correção.

### Prioridade P3 — Melhoria ou fase posterior

Inclui grupos familiares antes de sua fase, atualização automática de investimentos e otimizações não necessárias ao MVP.

## 5. Níveis de teste

### 5.1 Testes unitários

Devem cobrir funções puras e regras isoladas:

- soma e composição de saldos;
- arredondamento monetário;
- conversão cambial manual;
- cálculo de juros simples e compostos;
- divisão de parcelas e ajuste da última parcela;
- datas de recorrência e ciclos de fatura;
- progresso de metas;
- patrimônio líquido;
- classificação de eventos vencidos;
- normalização usada na detecção de duplicidades;
- decisões de permissão.

Testes unitários P0 e P1 devem executar em cada alteração de código.

### 5.2 Testes de componentes e serviços

Devem verificar cada módulo com dependências controladas:

- validação de formulários;
- importadores por formato e instituição;
- geração de arquivos;
- OCR por amostras conhecidas;
- renderização acessível de gráficos;
- notificações e transições de estado;
- anexos e validação de arquivos.

### 5.3 Testes de integração

Devem usar banco e serviços equivalentes aos de produção para validar:

- transações atômicas e concorrência;
- gravação pareada de transferências;
- saldo após edição, exclusão e restauração;
- fatura e quitação declarada;
- lote de importação e reversão;
- autorização no servidor;
- auditoria;
- armazenamento de anexos;
- filas de importação e exportação;
- migrações de banco.

### 5.4 Testes de contrato

Devem validar:

- esquemas de requisição e resposta da API;
- compatibilidade entre frontend e backend;
- versionamento dos formatos JSON exportados;
- contratos internos de filas;
- respostas de provedores externos somente quando integrações de consulta forem introduzidas.

### 5.5 Testes ponta a ponta

Devem permanecer enxutos e cobrir jornadas essenciais:

1. criar conta, registrar receita e despesa e conferir saldo;
2. registrar transferência e conferir patrimônio inalterado;
3. registrar compra parcelada, fechar fatura e registrar quitação sem duplicar despesa;
4. cadastrar recorrência, visualizar projeção e confirmar ocorrência;
5. importar extrato, resolver duplicidade e reverter lote;
6. exportar dados filtrados;
7. excluir movimentação, conferir saldo e restaurá-la;
8. ativar 2FA, entrar e encerrar outra sessão;
9. solicitar portabilidade e eliminação da conta;
10. aplicar permissões familiares quando o módulo existir.

### 5.6 Testes exploratórios

Devem investigar:

- linguagem que possa sugerir operação financeira real;
- compreensão de saldo disponível, guardado, investido e patrimônio;
- comportamento com dados incompletos;
- erros durante importações grandes;
- navegação por teclado;
- estados vazios e recuperação de erros;
- combinação incomum de filtros e moedas.

## 6. Tipos de teste não funcional

### 6.1 Segurança

- Verificação alinhada ao OWASP ASVS 5.0 nível 2.
- Autenticação, limitação de tentativas e recuperação.
- Fixação, roubo, expiração e revogação de sessão.
- Autorização horizontal e vertical.
- Injeção, XSS, CSRF, SSRF, upload malicioso e referências diretas inseguras.
- Proteção de segredos, dados mascarados e logs.
- Análise estática, dependências e segredos no repositório.
- Confirmação de que não existem endpoints, tokens ou permissões para operações financeiras externas.

### 6.2 Privacidade

- Portabilidade completa e legível.
- Isolamento entre usuários e grupos.
- Eliminação e anonimização nos prazos.
- Ausência de dados pessoais em telemetria e mensagens de erro.
- Retenção correta na lixeira, auditoria e backups.

### 6.3 Desempenho

- Carga e volume conforme RNF-006 a RNF-012.
- Pesquisa em 100 mil movimentações.
- Painel anual.
- Importação de 10 mil linhas ou 20 MB.
- Exportação de 100 mil registros.
- Concorrência nas alterações de saldo.
- Degradação controlada quando serviços gratuitos despertarem de estado inativo.

### 6.4 Acessibilidade

- Auditoria automatizada como apoio, nunca como única evidência.
- Navegação completa por teclado.
- Ordem de foco e foco visível.
- Nomes acessíveis, mensagens de erro e relações entre campos.
- Contraste, zoom de 200% e estados que não dependem de cor.
- Teste manual das jornadas essenciais com leitor de tela.

### 6.5 Compatibilidade

- Duas versões estáveis mais recentes de Chrome, Edge e Opera.
- Safari 17 ou superior.
- Instalação e atualização da PWA nos navegadores que oferecem instalação.
- Funcionamento como site quando a instalação não estiver disponível.

### 6.6 Continuidade

- Backup diário.
- Restauração trimestral em ambiente isolado.
- Verificação de RPO de 24 horas e RTO de 8 horas.
- Recuperação de fila interrompida.
- Consistência após falha durante operação atômica.

## 7. Ambientes

### Desenvolvimento

- Uso individual e testes rápidos.
- Dados sintéticos.
- Serviços externos simulados.
- Nenhuma credencial de produção.

### Integração e CI

- Ambiente descartável e reproduzível.
- Banco real do mesmo tipo de produção.
- Relógio e serviços externos controlados.
- Execução paralela sem compartilhamento de estado entre testes.

### Homologação

- Configuração equivalente à produção.
- Dados sintéticos representativos.
- Testes ponta a ponta, exploratórios, acessibilidade, desempenho e restauração.
- Sem acesso a operações financeiras externas.

### Produção

- Somente verificações não destrutivas, monitoramento sintético e smoke tests.
- Nenhum teste deve criar dados em contas de usuários reais.

## 8. Dados e massas de teste

Devem existir conjuntos versionados para:

- valores zero, negativos, muito grandes e limites de casas decimais;
- fevereiro, ano bissexto, fim de mês e mudança de ano;
- fusos horários e horário de verão histórico;
- moedas com duas, três e zero casas decimais;
- parcelas com divisão inexata;
- juros simples e compostos;
- faturas em aberto, fechadas, vencidas, parciais e quitadas;
- transferências, reembolsos e ajustes;
- arquivos OFX, CSV, XLSX, JSON e PDF válidos, inválidos e maliciosos;
- extratos do Inter, Nubank e Mercado Pago sem dados pessoais reais;
- duplicidades exatas, prováveis e falsos positivos;
- anexos permitidos, corrompidos, excessivos e com extensão falsa;
- permissões de todos os papéis.

Dados de teste devem ser sintéticos ou irreversivelmente anonimizados.

## 9. Automação e pipeline

### Em cada pull request

1. Formatação e análise estática.
2. Detecção de segredos.
3. Testes unitários.
4. Testes de integração afetados.
5. Análise de dependências.
6. Testes de contrato.
7. Smoke tests ponta a ponta das jornadas P0.

### Antes de homologação

1. Suíte completa unitária e de integração.
2. Ponta a ponta P0 e P1.
3. Auditoria automatizada de acessibilidade.
4. Verificação de migração.
5. Construção reprodutível da PWA.

### Antes da produção

1. Ausência de defeitos P0 ou P1 abertos.
2. Aprovação dos critérios de aceitação afetados.
3. Testes de segurança e permissões.
4. Testes exploratórios das mudanças.
5. Plano de reversão.
6. Backup válido e restauração recentemente comprovada.
7. Evidências armazenadas e vinculadas à versão.

### Execuções periódicas

- Suíte completa noturna.
- Segurança dinâmica em homologação.
- Desempenho em mudança relevante ou antes de release maior.
- Restauração trimestral.
- Compatibilidade mensal e antes de release maior.
- Revisão de acessibilidade por marco de produto.

## 10. Critérios de entrada e saída

### Entrada para teste de uma história

- Requisitos e critério de aceitação identificados.
- Regra de negócio e impactos conhecidos.
- Design ou contrato de API revisado quando aplicável.
- Dados e dependências disponíveis.
- Código implantado em ambiente adequado.

### Saída de uma história

- Critérios de aceitação aprovados.
- Testes automatizados P0 e P1 criados e aprovados.
- Sem defeitos P0 ou P1.
- Auditoria, segurança e acessibilidade verificadas quando afetadas.
- Documentação e rastreabilidade atualizadas.

### Saída de uma versão

- Todas as histórias cumprem sua definição de concluído.
- Regressão P0 e P1 aprovada.
- Metas não funcionais afetadas comprovadas.
- Migração e reversão ensaiadas.
- Riscos residuais registrados e aceitos.

## 11. Severidade de defeitos

- **S0 — Crítico:** perda ou corrupção de dados, acesso indevido, execução financeira externa, impossibilidade generalizada de autenticar ou restaurar backup. Bloqueia release e exige resposta imediata.
- **S1 — Alto:** saldo, patrimônio, fatura, parcela, permissão ou exportação incorretos; jornada essencial indisponível. Bloqueia release.
- **S2 — Médio:** função secundária incorreta com contorno seguro; pode ser aceita temporariamente.
- **S3 — Baixo:** problema visual, textual ou de conveniência sem impacto financeiro, de segurança ou acessibilidade relevante.

Prioridade define quando corrigir; severidade define o impacto. Ambas devem ser registradas.

## 12. Evidências e rastreabilidade

Cada execução relevante deve registrar:

- versão, ambiente e data;
- requisito, regra e critério relacionados;
- conjunto de dados utilizado;
- resultado esperado e observado;
- logs e capturas sem dados sensíveis;
- defeitos encontrados;
- responsável pela execução ou pipeline;
- decisão de aprovação.

## 13. Responsabilidades

- **Produto:** esclarece regras, prioriza riscos e aceita comportamento funcional.
- **Desenvolvimento:** cria testes unitários, integração e contrato junto com o código.
- **Qualidade:** mantém estratégia, cenários, exploração, regressão e evidências.
- **Segurança:** revisa ameaças e controles críticos, quando houver pessoa responsável.
- **Operação:** mantém ambientes, monitoramento, backup e restauração.

Em equipe pequena, uma pessoa pode exercer mais de um papel, mas as responsabilidades não deixam de existir.

## 14. Evolução

Este documento deve ser revisto quando houver:

- mudança no modelo de saldos ou patrimônio;
- nova integração externa;
- entrada do módulo familiar;
- atualização automática de investimentos;
- alteração de arquitetura, banco ou provedor;
- incidente de segurança ou perda de dados;
- mudança significativa de escala.
