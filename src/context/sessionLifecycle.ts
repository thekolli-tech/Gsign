import type { BrandingSettings } from '../types';

export interface SessionLike {
  userId?: string;
  isPlatformOwner?: boolean;
  isSuperAdmin?: boolean;
  role?: string | null;
}

export interface SessionLifecycleHandlers<TView extends string = string> {
  inviteToken?: string | null;
  getMe: () => Promise<SessionLike | null>;
  loadLiveWorkspaceData: (session: any) => Promise<void>;
  clearWorkspaceState: () => void;
  getSavedActiveView: () => TView | null;
  setActiveView: (view: TView) => void;
  setAuthLoading: (loading: boolean) => void;
  isMounted?: () => boolean;
}

const PUBLIC_VIEWS: string[] = [
  'landing',
  'signin',
  'register_company',
  'pricing',
  'contact_sales',
  'accept_invite',
  'privacy_policy',
  'terms_conditions',
];

export async function restoreAppSession<TView extends string = string>(
  handlers: SessionLifecycleHandlers<TView>,
): Promise<void> {
  const isMounted = handlers.isMounted ?? (() => true);
  try {
    if (handlers.inviteToken) {
      if (isMounted()) {
        handlers.setActiveView('accept_invite' as TView);
        handlers.setAuthLoading(false);
      }
      return;
    }

    const session = await handlers.getMe();
    if (!isMounted()) return;

    if (session && session.userId) {
      await handlers.loadLiveWorkspaceData(session);
      if (!isMounted()) return;

      const isAdminRoot = Boolean(
        session.isPlatformOwner || session.isSuperAdmin || session.role === 'PLATFORM_OWNER',
      );
      const saved = handlers.getSavedActiveView();
      if (saved && !PUBLIC_VIEWS.includes(saved)) {
        if (!isAdminRoot && saved.startsWith('superadmin_')) {
          handlers.setActiveView('dashboard' as TView);
        } else {
          handlers.setActiveView(saved);
        }
      } else {
        handlers.setActiveView(
          (isAdminRoot
            ? 'superadmin_tenants'
            : session.role === 'Company Admin'
              ? 'dashboard'
              : 'agreements') as TView,
        );
      }
    } else {
      handlers.clearWorkspaceState();
    }
  } catch {
    if (isMounted()) {
      handlers.clearWorkspaceState();
    }
  } finally {
    if (isMounted()) {
      handlers.setAuthLoading(false);
    }
  }
}

export async function performAppLogout<TView extends string = string>(params: {
  apiLogout: () => Promise<void>;
  removeSavedActiveView: () => void;
  clearWorkspaceState: () => void;
  resetUiState: (initialBranding: BrandingSettings) => void;
  initialBranding: BrandingSettings;
  setActiveView: (view: TView) => void;
}): Promise<void> {
  await params.apiLogout().catch(() => {});
  params.removeSavedActiveView();
  params.clearWorkspaceState();
  params.resetUiState(params.initialBranding);
  params.setActiveView('signin' as TView);
}
