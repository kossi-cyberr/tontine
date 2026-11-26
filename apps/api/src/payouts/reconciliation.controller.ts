import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/auth/roles.decorator';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @ApiOperation({ summary: 'Résultats de réconciliation (super admin)' })
  list() {
    return this.reconciliation.list();
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lancer une réconciliation immédiate (super admin)' })
  run() {
    return this.reconciliation.run();
  }
}
