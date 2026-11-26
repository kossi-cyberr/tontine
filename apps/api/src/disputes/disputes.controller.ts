import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DisputesService } from './disputes.service';
import {
  createDisputeSchema,
  listDisputesQuerySchema,
  updateDisputeSchema,
  type CreateDisputeInput,
  type ListDisputesQuery,
  type UpdateDisputeInput,
} from './disputes.schemas';

@ApiTags('Disputes')
@ApiBearerAuth()
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  @ApiOperation({ summary: 'Litiges visibles par l’utilisateur (tous pour un admin)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listDisputesQuerySchema)) query: ListDisputesQuery,
  ) {
    return this.disputes.list(user, query);
  }

  @Post()
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Ouvrir un litige avec pièces jointes (URLs)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createDisputeSchema)) body: CreateDisputeInput,
  ) {
    return this.disputes.create(user, body);
  }

  @Patch(':disputeId')
  @ApiOperation({ summary: 'Traiter un litige (super admin, décision motivée)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body(new ZodValidationPipe(updateDisputeSchema)) body: UpdateDisputeInput,
  ) {
    return this.disputes.update(user, disputeId, body);
  }
}
