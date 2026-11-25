import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ActiveSession } from '../../auth/session.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_SUBSCRIPTION_KEY = 'skipSubscriptionCheck';
export const SkipSubscription = () => SetMetadata(SKIP_SUBSCRIPTION_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);

export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenantId || null;
  }
);

export const CurrentSession = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): ActiveSession => {
    const request = ctx.switchToHttp().getRequest();
    return request.session;
  }
);
