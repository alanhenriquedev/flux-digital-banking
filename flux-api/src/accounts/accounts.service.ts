import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  createForUser(userId: string) {
    const number = this.generateAccountNumber();

    return this.prisma.account.create({
      data: {
        userId,
        number,
      },
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
