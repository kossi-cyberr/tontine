import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { payoutAccountSchema, type PayoutAccountInput } from '../auth/auth.schemas';
import { MeService, type UploadedDocument } from './me.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Post('kyc')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(5, 60_000)
  @UseInterceptors(FileInterceptor('document', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Soumettre une pièce d’identité (KYC)' })
  submitKyc(@CurrentUser() user: AuthUser, @UploadedFile() file?: UploadedDocument) {
    return this.me.submitKyc(user.id, file);
  }

  @Get('payout-accounts')
  @ApiOperation({ summary: 'Mes comptes de réception' })
  listPayoutAccounts(@CurrentUser() user: AuthUser) {
    return this.me.listPayoutAccounts(user.id);
  }

  @Post('payout-accounts')
  @RateLimit(10, 60_000)
  @ApiOperation({ summary: 'Ajouter un compte de réception (OTP, activation différée de 24 h)' })
  createPayoutAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(payoutAccountSchema)) body: PayoutAccountInput,
  ) {
    return this.me.createPayoutAccount(user.id, body);
  }
}
