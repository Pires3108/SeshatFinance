import type { Clock } from '@seshat/application';

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
