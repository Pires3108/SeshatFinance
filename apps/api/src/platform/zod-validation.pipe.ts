import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodValidationPipe<Output> implements PipeTransform<
  unknown,
  Output
> {
  public constructor(private readonly schema: ZodType<Output>) {}

  public transform(value: unknown): Output {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException('Invalid request payload.');
    }
    return result.data;
  }
}
