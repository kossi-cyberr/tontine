import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RoundsService } from './rounds.service';
import { GroupsRoundsController } from './groups-rounds.controller';
import { RoundsController } from './rounds.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [GroupsRoundsController, RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
