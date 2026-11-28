import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { restoreAppSession, performAppLogout } from './sessionLifecycle.ts';
import type { BrandingSettings } from '../types.ts';

const initialBranding: BrandingSettings = {
  logoText: 'GSIGN',
  logoUrl: '/gsign_logo.png',
  brandColor: '#5B13EC',
  emailDisplayName: 'GSIGN HR',
  customDomain: 'sign.gsign.in',
  dnsVerified: false,
  hidePoweredBy: false,
};

function createMutableStore() {
  const state = {
    currentUser: null as any,
    agreements: [{ id: 'AGR-OLD' }],
    receipts: [{ id: 'RCT-OLD' }],
    teamMembers: [{ id: 'USR-OLD' }],
    tenants: [{ id: 'TEN-OLD' }],
    templates: [{ id: 'TPL-OLD' }],
    selectedAgreementId: 'AGR-OLD',
    activeView: 'signin' as string,
    savedActiveView: 'agreements' as string | null,
    authLoading: true,
    branding: { ...initialBranding, logoText: 'Custom' },
  };

  const clearWorkspaceState = () => {
    state.currentUser = null;
    state.agreements = [];
    state.receipts = [];
    state.teamMembers = [];
    state.tenants = [];
    state.templates = [];
    state.selectedAgreementId = '';
    state.branding = initialBranding;
  };

  return { state, clearWorkspaceState };
}

describe('AppContext Session Restoration & Logout Regression', () => {
  it('preserves agreements, receipts, team members, tenants, templates, and selectedAgreementId on authenticated session restore', async () => {
    const { state, clearWorkspaceState } = createMutableStore();

    await restoreAppSession({
      getMe: async () => ({
        userId: 'user-1',
        role: 'Company Admin',
        isPlatformOwner: false,
        isSuperAdmin: false,
      }),
      loadLiveWorkspaceData: async (session) => {
        state.currentUser = session;
        state.agreements = [{ id: 'AGR-2026-0001' }];
        state.receipts = [{ id: 'RCT-2026-0001' }];
        state.teamMembers = [{ id: 'USR-1' }];
        state.tenants = [{ id: 'TEN-1' }];
        state.templates = [{ id: 'TPL-1' }];
        state.selectedAgreementId = 'AGR-2026-0001';
      },
      clearWorkspaceState,
      getSavedActiveView: () => state.savedActiveView,
      setActiveView: (v) => {
        state.activeView = v;
      },
      setAuthLoading: (v) => {
        state.authLoading = v;
      },
    });

    assert.equal(state.agreements.length, 1);
    assert.equal(state.agreements[0].id, 'AGR-2026-0001');
    assert.equal(state.receipts[0].id, 'RCT-2026-0001');
    assert.equal(state.teamMembers[0].id, 'USR-1');
    assert.equal(state.tenants[0].id, 'TEN-1');
    assert.equal(state.templates[0].id, 'TPL-1');
    assert.equal(state.selectedAgreementId, 'AGR-2026-0001');
    assert.equal(state.activeView, 'agreements');
    assert.equal(state.authLoading, false);
  });

  it('clears protected workspace data on unauthenticated startup', async () => {
    const { state, clearWorkspaceState } = createMutableStore();

    await restoreAppSession({
      getMe: async () => null,
      loadLiveWorkspaceData: async () => {
        throw new Error('Should not be called when unauthenticated');
      },
      clearWorkspaceState,
      getSavedActiveView: () => state.savedActiveView,
      setActiveView: (v) => {
        state.activeView = v;
      },
      setAuthLoading: (v) => {
        state.authLoading = v;
      },
    });

    assert.equal(state.currentUser, null);
    assert.deepEqual(state.agreements, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(state.teamMembers, []);
    assert.deepEqual(state.tenants, []);
    assert.deepEqual(state.templates, []);
    assert.equal(state.selectedAgreementId, '');
    assert.equal(state.authLoading, false);
  });

  it('clears protected workspace data when session restoration throws an error', async () => {
    const { state, clearWorkspaceState } = createMutableStore();

    await restoreAppSession({
      getMe: async () => {
        throw new Error('503 Service Unavailable');
      },
      loadLiveWorkspaceData: async () => {},
      clearWorkspaceState,
      getSavedActiveView: () => state.savedActiveView,
      setActiveView: (v) => {
        state.activeView = v;
      },
      setAuthLoading: (v) => {
        state.authLoading = v;
      },
    });

    assert.equal(state.currentUser, null);
    assert.deepEqual(state.agreements, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(state.teamMembers, []);
    assert.deepEqual(state.tenants, []);
    assert.deepEqual(state.templates, []);
    assert.equal(state.selectedAgreementId, '');
    assert.equal(state.authLoading, false);
  });

  it('clears protected workspace data and persisted active view on logout', async () => {
    const { state, clearWorkspaceState } = createMutableStore();
    state.currentUser = { userId: 'user-1' };
    state.activeView = 'agreements';
    let logoutCalled = false;

    await performAppLogout({
      apiLogout: async () => {
        logoutCalled = true;
      },
      removeSavedActiveView: () => {
        state.savedActiveView = null;
      },
      clearWorkspaceState,
      resetUiState: (b) => {
        state.branding = b;
      },
      initialBranding,
      setActiveView: (v) => {
        state.activeView = v;
      },
    });

    assert.equal(logoutCalled, true);
    assert.equal(state.savedActiveView, null);
    assert.equal(state.currentUser, null);
    assert.deepEqual(state.agreements, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(state.teamMembers, []);
    assert.deepEqual(state.tenants, []);
    assert.deepEqual(state.templates, []);
    assert.equal(state.selectedAgreementId, '');
    assert.equal(state.branding.logoText, 'GSIGN');
    assert.equal(state.activeView, 'signin');
  });

  it('routes authenticated users to workspace dashboard even if last saved view was landing or legal', async () => {
    for (const publicView of ['landing', 'privacy_policy', 'terms_conditions']) {
      const { state, clearWorkspaceState } = createMutableStore();
      state.savedActiveView = publicView;

      await restoreAppSession({
        getMe: async () => ({
          userId: 'user-1',
          role: 'Company Admin',
          isPlatformOwner: false,
          isSuperAdmin: false,
        }),
        loadLiveWorkspaceData: async (session) => {
          state.currentUser = session;
        },
        clearWorkspaceState,
        getSavedActiveView: () => state.savedActiveView,
        setActiveView: (v) => {
          state.activeView = v;
        },
        setAuthLoading: (v) => {
          state.authLoading = v;
        },
      });

      assert.equal(state.activeView, 'dashboard');
    }
  });
});
