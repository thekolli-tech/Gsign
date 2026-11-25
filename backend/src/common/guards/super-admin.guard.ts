import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User is unauthenticated');
    }

    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'Root platform access denied. Operation restricted to GSIGN Super Administrators.'
      );
    }

    return true;
  }
}
