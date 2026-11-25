import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/auth.decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user, session } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User is unauthenticated');
    }

    // Platform Owner and Super Admin inherit all role permissions
    if (user.isPlatformOwner || user.isSuperAdmin) {
      return true;
    }

    if (!session || !session.role) {
      throw new ForbiddenException('User has no assigned role for the active tenant');
    }

    const hasRole = requiredRoles.includes(session.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Requires one of the following roles: [${requiredRoles.join(', ')}]. Current role: '${session.role}'`
      );
    }

    return true;
  }
}
