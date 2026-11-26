import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/auth/public.decorator';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Webhooks')
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook agrégateur : signature vérifiée et anti-rejeu' })
  handle(
    @Param('provider') provider: string,
    @Headers('x-signature') signature: string | undefined,
    @Req() request: RawBodyRequest,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException({
        code: 'RAW_BODY_REQUIRED',
        message: 'Le corps brut de la requête est requis pour vérifier la signature.',
      });
    }
    return this.payments.handleWebhook(provider, request.rawBody, signature);
  }
}
