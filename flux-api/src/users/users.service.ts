import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByCpf(cpf: string) {
    return this.prisma.user.findUnique({ where: { cpf } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        cpf: true,
        createdAt: true,
      },
    });
  }

  findPasswordHashById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, passwordHash: true },
    });
  }

  updateUserPassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  findByEmailVerifyToken(tokenHash: string) {
    return this.prisma.user.findUnique({
      where: { emailVerifyToken: tokenHash },
    });
  }

  setEmailVerifyToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifyToken: tokenHash,
        emailVerifyTokenExpiry: expiresAt,
      },
    });
  }

  markAsVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerifyToken: null,
        emailVerifyTokenExpiry: null,
      },
    });
  }

  setPendingEmail(userId: string, pendingEmail: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail,
        pendingEmailToken: tokenHash,
        pendingEmailTokenExpiry: expiresAt,
      },
    });
  }

  findUserByPendingEmailToken(tokenHash: string) {
    return this.prisma.user.findUnique({
      where: { pendingEmailToken: tokenHash },
    });
  }

  confirmPendingEmailSwap(userId: string, newEmail: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailTokenExpiry: null,
      },
    });
  }

  findByPasswordResetToken(tokenHash: string) {
    return this.prisma.user.findUnique({
      where: { passwordResetToken: tokenHash },
    });
  }

  setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetToken: tokenHash,
        passwordResetTokenExpiry: expiresAt,
      },
    });
  }

  resetUserPassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }
}
