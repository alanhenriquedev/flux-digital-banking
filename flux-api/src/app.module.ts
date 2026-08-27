import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { CardsModule } from './cards/cards.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LoansModule } from './loans/loans.module';
import { SecurityModule } from './security/security.module';
import { GoalsModule } from './goals/goals.module';
import { AlertsModule } from './alerts/alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    AuthModule,
    CardsModule,
    NotificationsModule,
    LoansModule,
    SecurityModule,
GoalsModule,
AlertsModule,
  ],
})
export class AppModule {}
