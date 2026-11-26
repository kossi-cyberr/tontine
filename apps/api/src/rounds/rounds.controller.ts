import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RoundsService } from './rounds.service';

@ApiTags('Rounds')
@ApiBearerAuth()
@Controller('rounds')
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Get(':roundId')
  @ApiOperation({ summary: 'Détail d’un tour et de ses cotisations' })
  get(@CurrentUser() user: AuthUser, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.rounds.getRound(user, roundId);
  }
}
