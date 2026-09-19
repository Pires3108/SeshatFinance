import type { IdentifierGenerator } from '@seshat/application';

export class SequenceIdentifierGenerator implements IdentifierGenerator {
  private currentIndex = 0;

  public constructor(private readonly identifiers: readonly string[]) {}

  public generate(): string {
    const identifier = this.identifiers[this.currentIndex];
    if (identifier === undefined) {
      throw new Error('The identifier sequence is exhausted.');
    }
    this.currentIndex += 1;
    return identifier;
  }
}
