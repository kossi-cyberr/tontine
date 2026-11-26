import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('me/dashboard')
  @ApiOperation({ summary: 'Tableau de bord du membre (prochain paiement, mes tours)' })
  mine(@CurrentUser() user: AuthUser) {
    return this.dashboard.memberDashboard(user);
  }

  @Get('groups/:groupId/dashboard')
  @ApiOperation({ summary: 'Tableau de bord d’un groupe (membre ou président)' })
  group(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.dashboard.groupDashboard(user, groupId);
  }

  @Get('groups/:groupId/statement.csv')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Relevé du groupe au format CSV (Excel)' })
  async statement(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Res() response: Response,
  ) {
    const statement = await this.dashboard.statementCsv(user, groupId);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${statement.filename}"`);
    response.send(statement.content);
  }
}
