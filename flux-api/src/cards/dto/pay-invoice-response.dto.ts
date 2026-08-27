import { ApiProperty } from '@nestjs/swagger';
import { InvoiceResponse } from './invoice-response.dto';

export class PayInvoiceResponse {
  @ApiProperty({ example: 'Fatura paga com sucesso.' })
  message!: string;

  @ApiProperty({ type: InvoiceResponse })
  invoice!: InvoiceResponse;

  @ApiProperty({ example: 4960.0, description: 'Limite disponível após o pagamento' })
  availableLimit!: number;
}