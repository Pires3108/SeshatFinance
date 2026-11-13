# ADR-041 — Estados de atenção e atraso da fatura

**Status:** aceita para US-042 em 13/11/2026.

**Referências:** RF-046; RN-017, RN-022, RN-024; CA-008, CA-011, CA-021; INV-016, INV-017, INV-018; RII-015; ADR-037, ADR-039, ADR-040; US-042; SESHAT-58.

## Contexto

A US-042 pede que a API derive, a partir do vencimento efetivo, da obrigação remanescente e de um relógio injetado, se a fatura está próxima do vencimento ou vencida, e que a web apresente o estado por texto acessível. A antecedência de atenção é configurável, mas o requisito não definia o padrão.

## Decisão

- **Estados.** `no-purchases` (sem compras), `paid` (remanescente zero), `overdue` (data civil de hoje posterior ao vencimento efetivo, com remanescente), `attention` (faltam até N dias, inclusive o próprio dia do vencimento) e `on-time`. O dia do vencimento não é atraso.
- **Data de referência.** "Hoje" é a data civil do relógio no fuso do perfil do titular. O vencimento efetivo é o congelado na fatura (ADR-039), já deslocado por fim de semana e feriado (ADR-037).
- **Antecedência.** Padrão de 5 dias corridos, decidido pelo titular do produto em 13/11/2026, configurável por cartão entre 0 e 30 (`credit_cards.attention_days`).
- **Apresentação.** A API devolve `dueState` e `daysUntilDue` em lista, detalhe e fechamento. A web mostra rótulos textuais ("Vencida há N dias", "Atenção: vence em N dias", "Em dia", "Quitada", "Sem compras"). A cor é um reforço com contraste AA; vermelho só para fatura vencida com saldo.
- **Efeito de quitação.** O estado é recalculado a cada leitura, então uma quitação integral remove imediatamente o estado de dívida e uma parcial preserva a sinalização.

## Consequências

- A central de notificações, quando existir, deve usar o mesmo estado derivado. Uma preferência que desative notificações não esconde o estado na fatura.
- Nenhuma ação da tela altera limite real, bloqueia cartão ou paga fatura.
