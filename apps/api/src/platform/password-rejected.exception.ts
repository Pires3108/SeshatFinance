import { HttpException, HttpStatus } from '@nestjs/common';

export class PasswordRejectedException extends HttpException {
  public constructor() {
    super('Password rejected.', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
