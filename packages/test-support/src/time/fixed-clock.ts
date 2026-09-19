import type { Clock } from '@seshat/application';

export class FixedClock implements Clock {
  public constructor(private readonly instant: Date) {}

  public now(): Date {
    return new Date(this.instant.getTime());
  }
}
