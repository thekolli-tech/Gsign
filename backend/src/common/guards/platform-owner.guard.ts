import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class PlatformOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('User is unauthenticated');
    }

    if (!user.isPlatformOwner && user.role !== 'PLATFORM_OWNER') {
      throw new ForbiddenException(
        'Access denied. Operation strictly restricted to the GSIGN Platform Owner (Genemax).'
      );
    }

    return true;
  }
}
