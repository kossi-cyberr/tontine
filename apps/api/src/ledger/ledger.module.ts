import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { EscrowController } from './escrow.controller';

@Module({
  imports: [PrismaModule],
  controllers: [EscrowController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
