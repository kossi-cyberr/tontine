import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoundsService } from './rounds.service';
import { orderSchema, type OrderInput } from './rounds.schemas';

@ApiTags('Rounds')
@ApiBearerAuth()
@Controller('groups/:groupId')
export class GroupsRoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Post('draw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tirer l’ordre au sort (graine enregistrée)' })
  draw(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.rounds.draw(user, groupId);
  }

  @Put('order')
  @ApiOperation({ summary: 'Définir l’ordre de passage manuellement' })
  setOrder(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(orderSchema)) body: OrderInput,
  ) {
    return this.rounds.setOrder(user, groupId, body.member_ids);
  }

  @Post('launch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lancer le groupe et générer le calendrier' })
  launch(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.rounds.launch(user, groupId);
  }

  @Post('reminders')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60_000)
  @ApiOperation({ summary: 'Relancer les membres qui n’ont pas payé le tour courant' })
  remind(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.rounds.remindUnpaid(user, groupId);
  }

  @Get('rounds')
  @ApiOperation({ summary: 'Calendrier complet des tours' })
  list(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.rounds.listRounds(user, groupId);
  }

  @Get('rounds/current')
  @ApiOperation({ summary: 'Tour en cours (« qui reçoit ce tour ? »)' })
  current(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.rounds.currentRound(user, groupId);
  }
}
