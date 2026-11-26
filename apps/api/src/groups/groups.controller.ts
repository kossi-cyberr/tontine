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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/auth/current-user.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GroupsService } from './groups.service';
import {
  addMemberSchema,
  createGroupSchema,
  joinGroupSchema,
  listMembersQuerySchema,
  memberRoleSchema,
  replaceMemberSchema,
  updateGroupSchema,
  type AddMemberInput,
  type CreateGroupInput,
  type ReplaceMemberInput,
  type UpdateGroupInput,
} from './groups.schemas';

interface UploadedCsv {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@ApiTags('Groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Créer un groupe (le créateur devient président)' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ) {
    return this.groups.create(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Mes groupes' })
  list(@CurrentUser() user: AuthUser) {
    return this.groups.listForUser(user);
  }

  @Post('join')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(20, 60_000)
  @ApiOperation({ summary: 'Demander à rejoindre un groupe avec un code' })
  join(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinGroupSchema)) body: { invite_code: string },
  ) {
    return this.groups.join(user, body.invite_code);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Détail d’un groupe' })
  getById(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.getById(user, groupId);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Modifier un groupe (règles figées après lancement)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) body: UpdateGroupInput,
  ) {
    return this.groups.update(user, groupId, body);
  }

  @Post(':groupId/accept-rules')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accepter le règlement intérieur du groupe' })
  acceptRules(@CurrentUser() user: AuthUser, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.groups.acceptRules(user, groupId);
  }

  @Get(':groupId/members')
  @ApiOperation({ summary: 'Liste des membres' })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query(new ZodValidationPipe(listMembersQuerySchema))
    query: { status?: string; page: number; page_size: number },
  ) {
    return this.groups.listMembers(user, groupId, query);
  }

  @Post(':groupId/members')
  @ApiOperation({ summary: 'Créer un membre et envoyer le lien d’activation' })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput,
  ) {
    return this.groups.addMember(user, groupId, body);
  }

  @Post(':groupId/members/import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importer des membres depuis un CSV (full_name,phone,email)' })
  importMembers(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @UploadedFile() file?: UploadedCsv,
  ) {
    return this.groups.importCsv(user, groupId, file);
  }

  @Post(':groupId/members/:memberId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valider une demande d’adhésion' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.groups.approveMember(user, groupId, memberId);
  }

  @Patch(':groupId/members/:memberId/role')
  @ApiOperation({ summary: 'Attribuer un rôle à un membre' })
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(memberRoleSchema)) body: { role: CreateRole },
  ) {
    return this.groups.changeRole(user, groupId, memberId, body.role);
  }

  @Post(':groupId/members/:memberId/replace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remplacer un membre (position, dettes et tours à venir)' })
  replaceMember(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(replaceMemberSchema)) body: ReplaceMemberInput,
  ) {
    return this.groups.replaceMember(user, groupId, memberId, body);
  }

  @Post(':groupId/members/:memberId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspendre un membre' })
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.groups.suspendMember(user, groupId, memberId);
  }
}

type CreateRole = 'president' | 'treasurer' | 'member' | 'observer';
