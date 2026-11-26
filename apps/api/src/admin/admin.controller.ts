import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';
import {
  adminGroupsQuerySchema,
  adminUsersQuerySchema,
  auditLogsQuerySchema,
  cancelRoundSchema,
  kycDecisionSchema,
  settingsUpdateSchema,
  type AdminGroupsQuery,
  type AdminUsersQuery,
  type AuditLogsQuery,
  type CancelRoundInput,
  type KycDecisionInput,
  type SettingsUpdateInput,
} from './admin.schemas';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Indicateurs globaux (super admin)' })
  stats() {
    return this.admin.stats();
  }

  @Get('groups')
  @ApiOperation({ summary: 'Tous les groupes (super admin)' })
  groups(@Query(new ZodValidationPipe(adminGroupsQuerySchema)) query: AdminGroupsQuery) {
    return this.admin.listGroups(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'Tous les utilisateurs (super admin)' })
  users(@Query(new ZodValidationPipe(adminUsersQuerySchema)) query: AdminUsersQuery) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:userId/kyc')
  @ApiOperation({ summary: 'Valider ou rejeter le KYC avec motif' })
  decideKyc(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(kycDecisionSchema)) body: KycDecisionInput,
  ) {
    return this.admin.decideKyc(user.id, userId, body);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Paramètres globaux' })
  settings() {
    return this.admin.listSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Modifier les paramètres globaux' })
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(settingsUpdateSchema)) body: SettingsUpdateInput,
  ) {
    return this.admin.updateSettings(user.id, body);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Journal d’audit filtrable' })
  auditLogs(@Query(new ZodValidationPipe(auditLogsQuerySchema)) query: AuditLogsQuery) {
    return this.audit.list(query);
  }

  @Post('rounds/:roundId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annuler un tour et rembourser les cotisations' })
  cancelRound(
    @CurrentUser() user: AuthUser,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body(new ZodValidationPipe(cancelRoundSchema)) body: CancelRoundInput,
  ) {
    return this.admin.cancelRound(user.id, roundId, body);
  }
}
