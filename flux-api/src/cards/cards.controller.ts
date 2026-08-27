import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardsService } from './cards.service';
import { CardResponse } from './dto/card-response.dto';
import { CardPurchaseResponse } from './dto/card-purchase-response.dto';
import { CreateCardPurchaseDto } from './dto/create-card-purchase.dto';
import { InvoiceDetailResponse, InvoiceResponse } from './dto/invoice-response.dto';

@ApiTags('cards')
@ApiBearerAuth()
@Controller('cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Criar (ou obter) o cartão virtual do usuário autenticado' })
  @ApiResponse({ status: 201, description: 'Cartão virtual criado ou já existente', type: CardResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta não encontrada' })
  create(@CurrentUser() user: { userId: string }) {
    return this.cardsService.findOrCreateVirtual(user.userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar cartões do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de cartões do usuário', type: [CardResponse] })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta não encontrada' })
  listMine(@CurrentUser() user: { userId: string }) {
    return this.cardsService.listForUser(user.userId);
  }

  @Post('me/purchases')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Registrar uma compra no cartão do usuário autenticado' })
  @ApiResponse({ status: 201, description: 'Compra registrada com sucesso', type: CardPurchaseResponse })
  @ApiResponse({ status: 400, description: 'Dados inválidos (valor, precisão ou descrição)' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta ou cartão não encontrado' })
  @ApiResponse({ status: 422, description: 'Cartão bloqueado ou limite disponível insuficiente' })
  purchase(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCardPurchaseDto,
  ) {
    return this.cardsService.createPurchase(user.userId, dto);
  }

  @Post('me/block')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Bloquear o cartão do usuário autenticado' })
  @ApiResponse({ status: 201, description: 'Cartão bloqueado', type: CardResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta ou cartão não encontrado' })
  block(@CurrentUser() user: { userId: string }) {
    return this.cardsService.block(user.userId);
  }

  @Post('me/unblock')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Desbloquear o cartão do usuário autenticado' })
  @ApiResponse({ status: 201, description: 'Cartão desbloqueado', type: CardResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta ou cartão não encontrado' })
  unblock(@CurrentUser() user: { userId: string }) {
    return this.cardsService.unblock(user.userId);
  }

  @Get('me/invoices')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Listar faturas do cartão do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Lista de faturas', type: [InvoiceResponse] })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta não encontrada' })
  listInvoices(@CurrentUser() user: { userId: string }) {
    return this.cardsService.listInvoices(user.userId);
  }

  @Get('me/invoices/:invoiceId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Detalhar uma fatura do usuário autenticado (com compras)' })
  @ApiResponse({ status: 200, description: 'Detalhe da fatura com compras', type: InvoiceDetailResponse })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Conta ou fatura não encontrada' })
  invoiceDetail(
    @CurrentUser() user: { userId: string },
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.cardsService.getInvoiceDetail(user.userId, invoiceId);
  }
}