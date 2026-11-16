import type {
  IdempotencyRequest,
  LoanEventWrite,
  LoanRecord,
  LoanRenegotiationWrite,
  LoanRepository,
} from '@seshat/application';
import type { FinancialAuditEvent, Loan } from '@seshat/domain';
import { PrismaLoanRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyLoanRepository implements LoanRepository {
  private repository: PrismaLoanRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findIdempotentResponse(
    request: IdempotencyRequest,
  ): Promise<string | null> {
    return this.getRepository().findIdempotentResponse(request);
  }

  public findByIdForOwner(
    id: string,
    ownerId: string,
  ): Promise<LoanRecord | null> {
    return this.getRepository().findByIdForOwner(id, ownerId);
  }

  public listForOwner(ownerId: string): Promise<readonly LoanRecord[]> {
    return this.getRepository().listForOwner(ownerId);
  }

  public insertAtomically(
    request: IdempotencyRequest,
    loan: Loan,
    auditEvent: FinancialAuditEvent,
    response: string,
  ): Promise<string> {
    return this.getRepository().insertAtomically(
      request,
      loan,
      auditEvent,
      response,
    );
  }

  public appendEventAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanEventWrite,
  ): Promise<string | null> {
    return this.getRepository().appendEventAtomically(
      request,
      loanId,
      ownerId,
      build,
    );
  }

  public renegotiateAtomically(
    request: IdempotencyRequest,
    loanId: string,
    ownerId: string,
    build: (record: LoanRecord) => LoanRenegotiationWrite,
  ): Promise<string | null> {
    return this.getRepository().renegotiateAtomically(
      request,
      loanId,
      ownerId,
      build,
    );
  }

  private getRepository(): PrismaLoanRepository {
    this.repository ??= new PrismaLoanRepository(this.prisma.get());
    return this.repository;
  }
}
