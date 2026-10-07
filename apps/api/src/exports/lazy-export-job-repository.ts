import type { ExportJob, ExportJobRepository } from '@seshat/application';
import { PrismaExportJobRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';
import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyExportJobRepository implements ExportJobRepository {
  private repository: PrismaExportJobRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findByIdempotencyKey(
    actorId: string,
    idempotencyKey: string,
  ): Promise<ExportJob | null> {
    return this.getRepository().findByIdempotencyKey(actorId, idempotencyKey);
  }

  public create(job: ExportJob): Promise<ExportJob> {
    return this.getRepository().create(job);
  }

  public getOwned(actorId: string, jobId: string): Promise<ExportJob | null> {
    return this.getRepository().getOwned(actorId, jobId);
  }

  public update(job: ExportJob): Promise<ExportJob> {
    return this.getRepository().update(job);
  }

  private getRepository(): PrismaExportJobRepository {
    this.repository ??= new PrismaExportJobRepository(this.prisma.get());
    return this.repository;
  }
}
