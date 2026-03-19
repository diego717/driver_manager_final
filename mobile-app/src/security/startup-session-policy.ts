let startupSessionResetApplied = false;

// No formal requirement exists to share auth across web tabs. Each tab should re-check
// auth independently; forcing a session reset on open from each screen creates false
// logouts when the user navigates after signing in.
export const FORCE_LOGIN_ON_OPEN = false;

export function consumeForceLoginOnOpenFlag(): boolean {
  if (!FORCE_LOGIN_ON_OPEN || startupSessionResetApplied) {
    return false;
  }
  startupSessionResetApplied = true;
  return true;
}

export function __resetStartupSessionPolicyForTests(): void {
  startupSessionResetApplied = false;
}
