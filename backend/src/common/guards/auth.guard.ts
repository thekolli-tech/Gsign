import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService } from '../../auth/session.service';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const sessionId = this.extractSessionId(request);

    if (!sessionId) {
      throw new UnauthorizedException('No authentication session token provided');
    }

    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      throw new UnauthorizedException('Session expired, revoked, or invalid');
    }

    // Attach verified identity and tenant context to Request
    request.user = {
      id: session.userId,
      email: session.email,
      fullName: session.fullName,
      isSuperAdmin: session.isSuperAdmin,
    };
    request.session = session;
    request.tenantId = session.tenantId;

    return true;
  }

  private extractSessionId(request: any): string | null {
    // 1. Check HttpOnly cookies (__Host-gsign_session or gsign_session)
    if (request.cookies) {
      if (request.cookies['__Host-gsign_session']) {
        return request.cookies['__Host-gsign_session'];
      }
      if (request.cookies['gsign_session']) {
        return request.cookies['gsign_session'];
      }
    }

    // 2. Check Authorization Header (Bearer token)
    const authHeader = request.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }

    // 3. Check custom header (X-Session-ID)
    if (request.headers?.['x-session-id']) {
      return request.headers['x-session-id'];
    }

    return null;
  }
}
