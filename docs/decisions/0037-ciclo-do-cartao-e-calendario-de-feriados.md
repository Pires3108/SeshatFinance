# ADR-037 — Ciclo do cartão e calendário de feriados

**Status:** aceita para US-038 em 13/11/2026.

**Referências:** RII-015; RF-038 a RF-042; RN-018; INV-016, INV-017; US-038, US-039, US-040, US-042; decisões registradas em SESHAT-54 (28/09/2026) e pelo titular do produto em 13/11/2026.

## Contexto

O cadastro de cartão guardava os dias de fechamento e vencimento sem materializar datas. A RII-015 foi decidida: dia ausente vale o último dia do mês; vencimento igual ou anterior ao fechamento pertence ao mês seguinte; vencimento em fim de semana ou feriado nacional, estadual ou municipal do local do titular passa ao primeiro dia útil; o ciclo é semiaberto, e por padrão a compra no fechamento vai para a próxima fatura, com opção de incluí-la na fatura que fecha; o fuso é IANA. O complemento de 28/09/2026 pede uma fonte de feriados versionada e atualizável.

## Decisão

- **Granularidade civil.** O "instante de fechamento" é o dia de fechamento, na data civil obtida do instante da compra no fuso do perfil do titular (ADR-034). `next-cycle` (padrão): a compra no dia de fechamento abre a próxima fatura. `closing-cycle`: ela é o último dia da fatura que fecha.
- **Domínio puro.** `CivilDate` faz a aritmética de calendário sem fuso. `CardCycleSchedule` materializa fechamento e vencimento: dia configurado acima do último dia do mês vale o último dia; o vencimento cai no mês seguinte quando o dia de vencimento é menor ou igual ao de fechamento; `nextBusinessDay` pula fins de semana e feriados recebidos por predicado. Cada data civil pertence a exatamente um ciclo contíguo.
- **Dia útil.** Feriados legais (nacionais, da UF e do município) mais segunda e terça de Carnaval e 31/12, que não têm expediente bancário. Corpus Christi só conta onde a lei local o declara feriado.
- **Fonte versionada.** `brazil-holiday-rules.ts` guarda o dataset com `BRAZIL_HOLIDAY_DATASET_VERSION` e a fonte de cada entrada: leis nacionais; feriados estaduais das 27 UFs e municipais das 27 capitais segundo o levantamento dos calendários forenses de 2026 (Sijur, lido em 13/11/2026), que cita a lei ou o ato de cada data. Regras móveis usam a Páscoa gregoriana; a transferência ao domingo seguinte de Santa Catarina (Lei 18.531/2022) é uma regra própria. Os códigos IBGE das capitais foram conferidos na API de localidades do IBGE.
- **Excluídos para revisão.** AL 30/11, PE 24/06 e os feriados transferidos do Acre (Lei 2.126/2009) ficam em `EXCLUDED_PENDING_REVIEW` e não são aplicados.
- **Local e feriados declarados.** O local (UF e município IBGE) e os feriados municipais declarados pelo titular ficam em `user_holiday_settings` e `user_declared_holidays`, com escopo por titular, fora do perfil, para não alterar o contrato e a versão do perfil. O titular pode declarar feriados anuais (inclusive 29/02, aplicado só em anos bissextos) ou de um ano específico.
- **Edição do cartão.** `credit_cards` ganha `closing_boundary` e `version`. `PATCH /api/v1/credit-cards/:cardId` exige `expectedVersion`, grava a alteração e um evento de auditoria `updated` na mesma transação e retorna 409 em versão divergente. A moeda do limite não muda; o limite continua sendo estimativa organizacional (INV-016).
- **Consulta.** `GET /api/v1/credit-cards/:cardId/cycle?at=` devolve o ciclo que contém o instante (padrão: agora), com fechamento, vencimento programado e efetivo, fuso e versão do dataset.

## Consequências

- Faturas ainda não são materializadas. A US-040 deve gravar as datas de cada fatura ao formá-la, para que mudanças de configuração ou de dataset não reescrevam faturas fechadas.
- Atualizar o dataset exige nova versão e entrada com fonte. Municípios fora das capitais dependem de feriados declarados pelo titular.
- O deslocamento usa o calendário vigente da versão em uso; datas históricas recalculadas podem mudar se o dataset mudar antes da US-040.

## Alternativas consideradas

- **Somente feriados nacionais:** rejeitada pela decisão de 28/09/2026, que inclui estaduais e municipais.
- **Dataset municipal completo:** rejeitado nesta etapa pelo custo de curadoria; feriados declarados cobrem os demais municípios.
- **Campos de local no perfil:** rejeitados para não acoplar o contrato do perfil e sua versão à configuração de feriados.
