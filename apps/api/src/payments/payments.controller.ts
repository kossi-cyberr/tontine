import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';
import { payContributionSchema, type PayContributionInput } from './payments.schemas';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('contributions/:contributionId/pay')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(20, 60_000)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Initier le paiement d’une cotisation (Mobile Money)' })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(payContributionSchema)) body: PayContributionInput,
  ) {
    return this.payments.payContribution(user, contributionId, idempotencyKey, body);
  }

  @Get('payments/:paymentId')
  @ApiOperation({ summary: 'Statut d’un paiement' })
  get(@CurrentUser() user: AuthUser, @Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.getPayment(user, paymentId);
  }

  @Get('payments/:paymentId/receipt')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Reçu PDF d’un paiement confirmé' })
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Res() response: Response,
  ) {
    const receipt = await this.payments.getReceipt(user, paymentId);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
    response.end(receipt.buffer);
  }

  @Get('me/payments')
  @ApiOperation({ summary: 'Mon historique de paiements' })
  listMine(@CurrentUser() user: AuthUser) {
    return this.payments.listMyPayments(user);
  }
}
