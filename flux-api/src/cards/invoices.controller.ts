import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardsService } from './cards.service';
import { PayInvoiceResponse } from './dto/pay-invoice-response.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly cardsService: CardsService) {}

  @Post(':invoiceId/pay')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Pagar integralmente uma fatura do usuário autenticado' })
  @ApiResponse({ status: 201, description: 'Fatura paga com sucesso', type: PayInvoiceResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Fatura não encontrada' })
  @ApiResponse({ status: 409, description: 'Fatura já paga' })
  @ApiResponse({ status: 422, description: 'Saldo insuficiente ou fatura sem valor a pagar' })
  pay(@CurrentUser() user: { userId: string }, @Param('invoiceId') invoiceId: string) {
    return this.cardsService.payInvoice(user.userId, invoiceId);
  }
}