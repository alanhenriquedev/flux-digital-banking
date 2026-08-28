import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(userId: string) {
    const number = this.generateAccountNumber();

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { userId, number },
      });
      await tx.transaction.create({
        data: {
          accountId: account.id,
          type: 'ACCOUNT_OPENING',
          direction: 'IN',
          status: 'COMPLETED',
          amount: new Prisma.Decimal('1000.00'),
          description: 'Crédito inicial de abertura da conta',
          counterpartyName: 'Flux',
        },
      });
      return account;
    });
  }

  findByUserId(userId: string) {
    return this.prisma.account.findUnique({ where: { userId } });
  }

  private generateAccountNumber(): string {
    const digits = Array.from({ length: 8 }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
    return digits;
  }
}
