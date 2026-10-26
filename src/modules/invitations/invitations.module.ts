import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import {
  InvitationsController,
  OrganizationInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [OrganizationInvitationsController, InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
