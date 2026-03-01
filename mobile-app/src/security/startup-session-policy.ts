let startupSessionResetApplied = false;

export const FORCE_LOGIN_ON_OPEN = true;

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
