# Seshat Finance — Matriz de rastreabilidade

## 1. Objetivo

Esta matriz relaciona áreas funcionais, requisitos, regras e critérios de aceitação. Intervalos indicam cobertura conjunta.

| Área           | Requisitos funcionais | Regras                           | Aceitação                              | Não funcionais                       |
| -------------- | --------------------- | -------------------------------- | -------------------------------------- | ------------------------------------ |
| Identidade     | RF-001 a RF-008       | RN-054 a RN-057                  | CA-001, CA-002, CA-020                 | RNF-021 a RNF-040                    |
| Família        | RF-009 a RF-014       | RN-049 a RN-053                  | CA-019                                 | RNF-029, RNF-032, RNF-038            |
| Contas         | RF-015 a RF-020       | RN-001 a RN-010                  | CA-003, CA-005, CA-006, CA-018, CA-024 | RNF-047 a RNF-052                    |
| Classificação  | RF-021 a RF-025       | RN-013, RN-014                   | CA-004, CA-018                         | RNF-006 a RNF-012                    |
| Movimentações  | RF-026 a RF-037       | RN-006 a RN-014, RN-025 a RN-027 | CA-004 a CA-007, CA-010                | RNF-047 a RNF-052                    |
| Cartões        | RF-038 a RF-046       | RN-015 a RN-024                  | CA-008, CA-009, CA-011                 | RNF-046 a RNF-052                    |
| Metas          | RF-047 a RF-050       | RN-031 a RN-033                  | CA-013, CA-018                         | RNF-047 a RNF-052                    |
| Investimentos  | RF-051 a RF-056       | RN-034 a RN-037                  | CA-014                                 | RNF-047 a RNF-054                    |
| Projeções      | RF-057 a RF-063       | RN-025 a RN-030                  | CA-010 a CA-012                        | RNF-006 a RNF-012, RNF-057           |
| Painéis        | RF-064 a RF-073       | RN-003 a RN-005                  | CA-018, CA-021, CA-022                 | RNF-006 a RNF-012, RNF-041 a RNF-046 |
| Importação     | RF-074 a RF-080       | RN-038 a RN-044                  | CA-015, CA-016                         | RNF-010, RNF-030, RNF-049            |
| Exportação     | RF-081 a RF-084       | RN-045                           | CA-017                                 | RNF-011, RNF-035, RNF-039            |
| Notificações   | RF-085 a RF-090       | RN-046 a RN-057                  | CA-007, CA-011, CA-020                 | RNF-019, RNF-032, RNF-055 a RNF-058  |
| Acessibilidade | RF-001 a RF-090       | RN-024, RN-054                   | CA-021                                 | RNF-041 a RNF-046                    |
| Continuidade   | Todos                 | RN-001 a RN-057                  | CA-023                                 | RNF-013 a RNF-020                    |

## 2. Decisões inferidas

| Decisão                                                | Motivo                                                                                 | Registros                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| PWA web instalável                                     | Entrega web e desktop com uma base                                                     | Escopo; RNF-001 a RNF-004                  |
| Pagamento de fatura é somente registrado como quitação | Evita dupla contabilização e não sugere execução externa                               | RF-039, RF-044; RN-001, RN-015, RN-016     |
| A plataforma é exclusivamente organizacional           | Impede iniciação, bloqueio, autorização ou cancelamento de transações reais            | Limite operacional; RN-001; CA-005, CA-008 |
| Contas individuais são privadas                        | Aplica menor privilégio                                                                | RF-011; RN-049                             |
| Lixeira retém por 30 dias                              | Recuperação e integridade                                                              | RF-032, RF-090; RNF-056                    |
| Backup diário retido por 14 dias                       | Reduz perda e interpreta “duas semanas” como retenção                                  | RNF-015 a RNF-018                          |
| WCAG 2.2 AA                                            | Padrão verificável atual                                                               | RNF-041 a RNF-046                          |
| Monitoramento sem dados financeiros                    | Mede disponibilidade sem acesso de suporte                                             | RNF-013, RNF-019, RNF-040                  |
| Câmbio manual e consulta multimoeda no MVP             | Preserva origem e versões; totaliza por moeda e informa indisponibilidade de conversão | RF-020; RN-002; CA-003; INV-029; US-022    |
| Baselines mensuráveis                                  | Substitui itens indefinidos                                                            | RNF-006 a RNF-012                          |

## 3. Gestão de mudanças

- Identificadores não devem ser reutilizados.
- Mudança funcional deve atualizar requisito, regra, aceitação e matriz.
- Itens de fase posterior não bloqueiam a aceitação da primeira versão.
- Mudanças em saldo, patrimônio, fatura, juros ou retenção exigem revisão dos testes críticos.

## 4. Documentos de teste

- A Estratégia de Testes define níveis, tipos, ambientes, dados, pipeline, critérios de entrada e saída e severidade de defeitos.
- O Catálogo de Invariantes Financeiras define propriedades permanentes de saldo, patrimônio, faturas, projeções, importação, autorização e isolamento operacional.
- Cada história deve relacionar seus requisitos e regras aos critérios de aceitação e invariantes aplicáveis.

## 5. Planejamento de implementação

- O documento 13-backlog-roadmap-e-sprints-seshat-finance.md organiza os requisitos em épicos, histórias, dependências, marcos e sprints.
- As histórias US-001 a US-101 compõem o plano-base do MVP.
- As histórias US-102 a US-125 pertencem às fases pós-MVP de grupos familiares e atualização automática de investimentos.
- A alocação em sprint é baseline e deve ser recalibrada com a velocidade real sem remover controles de qualidade.
