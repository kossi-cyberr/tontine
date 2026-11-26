import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PayoutsService } from './payouts.service';
import {
  approvePayoutSchema,
  requestPayoutSchema,
  type ApprovePayoutInput,
  type RequestPayoutInput,
} from './payouts.schemas';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('rounds/:roundId/payout/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Demander le décaissement d’un tour (conditions §8.3)' })
  request(
    @CurrentUser() user: AuthUser,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body(new ZodValidationPipe(requestPayoutSchema)) body: RequestPayoutInput,
  ) {
    return this.payouts.request(user, roundId, body);
  }

  @Post('rounds/:roundId/payout/approve')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Approuver le décaissement (OTP obligatoire, demandeur ≠ approbateur)' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body(new ZodValidationPipe(approvePayoutSchema)) body: ApprovePayoutInput,
  ) {
    return this.payouts.approve(user, roundId, body.otp_code);
  }

  @Get('rounds/:roundId/payout')
  @ApiOperation({ summary: 'Décaissement et éligibilité du tour' })
  getForRound(@CurrentUser() user: AuthUser, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.payouts.getRoundPayout(user, roundId);
  }

  @Get('payouts/:payoutId')
  @ApiOperation({ summary: 'Statut d’un décaissement' })
  get(@CurrentUser() user: AuthUser, @Param('payoutId', ParseUUIDPipe) payoutId: string) {
    return this.payouts.getPayout(user, payoutId);
  }

  @Get('payouts/:payoutId/receipt')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Justificatif PDF d’un décaissement exécuté' })
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Res() response: Response,
  ) {
    const receipt = await this.payouts.getReceipt(user, payoutId);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${receipt.filename}"`);
    response.end(receipt.buffer);
  }
}
