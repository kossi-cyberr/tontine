import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { isPlatformAdmin, notFoundGroup } from '../groups/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

@ApiTags('Escrow')
@ApiBearerAuth()
@Controller('groups/:groupId')
export class EscrowController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  private async assertMember(actor: AuthUser, groupId: string): Promise<void> {
    const group = await this.prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) notFoundGroup();

    if (isPlatformAdmin(actor)) return;

    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: actor.id } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException({
        code: 'NOT_A_MEMBER',
        message: 'Vous ne faites pas partie de ce groupe.',
      });
    }
  }

  @Get('escrow')
  @ApiOperation({ summary: 'Solde du séquestre du groupe (lecture seule)' })
  async getEscrow(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    await this.assertMember(user, groupId);

    const account = await this.prisma.escrow_accounts.findUnique({
      where: { group_id: groupId },
    });

    if (!account) {
      return {
        account_id: null,
        balance: 0,
        guarantee_balance: 0,
        currency: 'XAF',
        consistent: true,
      };
    }

    const balance = await this.ledger.getBalance(account.id);
    return {
      account_id: account.id,
      balance: balance.cached_balance,
      cached_balance: balance.cached_balance,
      guarantee_balance: balance.guarantee_balance,
      currency: balance.currency,
      consistent: balance.consistent,
    };
  }

  @Get('ledger')
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'page_size', required: false, type: Number })
  @ApiOperation({ summary: 'Mouvements du grand livre, du plus récent au plus ancien' })
  async getLedger(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
  ) {
    await this.assertMember(user, groupId);

    const account = await this.prisma.escrow_accounts.findUnique({
      where: { group_id: groupId },
      select: { id: true },
    });
    if (!account) return [];

    const entries = await this.prisma.ledger_entries.findMany({
      where: { escrow_account_id: account.id },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        type: true,
        debit: true,
        credit: true,
        description: true,
        round_id: true,
        reference_table: true,
        reference_id: true,
        created_at: true,
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      debit: Number(entry.debit),
      credit: Number(entry.credit),
      description: entry.description,
      round_id: entry.round_id,
      reference_table: entry.reference_table,
      reference_id: entry.reference_id,
      created_at: entry.created_at.toISOString(),
    }));
  }
}
