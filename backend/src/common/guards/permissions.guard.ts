import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/auth.decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user, session } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User is unauthenticated');
    }

    if (user.isPlatformOwner || user.isSuperAdmin) {
      return true;
    }

    const userPerms: string[] = session?.permissions || [];
    const hasAll = requiredPermissions.every(p => userPerms.includes(p));

    if (!hasAll) {
      throw new ForbiddenException(
        `Insufficient permissions. Requires: [${requiredPermissions.join(', ')}]`
      );
    }

    return true;
  }
}
