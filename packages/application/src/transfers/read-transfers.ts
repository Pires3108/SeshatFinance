import type { Transfer, TransactionLifecycle } from '@seshat/domain';

export interface TransferReadRepository {
  findByIdForOwner(id: string, ownerId: string): Promise<Transfer | null>;
  listForOwner(
    ownerId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transfer[]>;
}

export class GetOwnedTransferUseCase {
  public constructor(private readonly transfers: TransferReadRepository) {}

  public execute(id: string, actorId: string): Promise<Transfer | null> {
    return this.transfers.findByIdForOwner(id, actorId);
  }
}

export class ListOwnedTransfersUseCase {
  public constructor(private readonly transfers: TransferReadRepository) {}

  public execute(
    actorId: string,
    lifecycle?: TransactionLifecycle,
  ): Promise<readonly Transfer[]> {
    return this.transfers.listForOwner(actorId, lifecycle);
  }
}
