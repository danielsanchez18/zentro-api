import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';

interface AuthedRequest {
  user: { userId: string };
}

/**
 * Suscripciones y facturas del Hub (solo lectura; requiere `BILLING.READ` en cada org).
 *   GET /users/me/subscriptions
 *   GET /users/me/invoices
 */
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('subscriptions')
  list(@Req() req: AuthedRequest) {
    return this.subscriptions.listMine(req.user.userId);
  }

  @Get('invoices')
  invoices(@Req() req: AuthedRequest) {
    return this.subscriptions.listInvoices(req.user.userId);
  }
}
