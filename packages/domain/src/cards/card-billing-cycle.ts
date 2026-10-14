export type CardBillingCycleProperties = Readonly<{
  startsAt: Date;
  closesAt: Date;
  timeZone: string;
  closingBoundary: 'next-cycle' | 'closing-cycle';
}>;

export class InvalidCardBillingCycleError extends Error {
  public constructor() {
    super('Card billing cycle boundaries and IANA time zone must be valid.');
    this.name = 'InvalidCardBillingCycleError';
  }
}

/** Explicit instants come from the civil calendar application port. */
export class CardBillingCycle {
  private constructor(private readonly state: CardBillingCycleProperties) {}

  public static create(
    properties: CardBillingCycleProperties,
  ): CardBillingCycle {
    if (
      !Number.isFinite(properties.startsAt.getTime()) ||
      !Number.isFinite(properties.closesAt.getTime()) ||
      properties.startsAt.getTime() >= properties.closesAt.getTime() ||
      !['next-cycle', 'closing-cycle'].includes(properties.closingBoundary)
    )
      throw new InvalidCardBillingCycleError();
    try {
      new Intl.DateTimeFormat('en', { timeZone: properties.timeZone }).format(
        properties.startsAt,
      );
    } catch {
      throw new InvalidCardBillingCycleError();
    }
    return new CardBillingCycle({
      ...properties,
      startsAt: new Date(properties.startsAt),
      closesAt: new Date(properties.closesAt),
    });
  }

  public contains(occurredAt: Date): boolean {
    const instant = occurredAt.getTime();
    if (!Number.isFinite(instant)) throw new InvalidCardBillingCycleError();
    const start = this.state.startsAt.getTime();
    const close = this.state.closesAt.getTime();
    return this.state.closingBoundary === 'next-cycle'
      ? instant >= start && instant < close
      : instant > start && instant <= close;
  }

  public toSnapshot(): CardBillingCycleProperties {
    return {
      ...this.state,
      startsAt: new Date(this.state.startsAt),
      closesAt: new Date(this.state.closesAt),
    };
  }
}
