export {
  gateDocumentRequest,
  isOpenPath,
  OPEN_EXACT_PATHS,
  OPEN_METHOD_RULES,
  OPEN_PATH_PREFIXES,
  safeNextPath,
  signInUrl,
} from './require-sign-in'

// Read at call time (not module load) so tests and hot reloads see the current
// environment. The Enterprise profile sets SEED_REQUIRE_SIGN_IN=1.
export function requireSignInEnabled(): boolean {
  const value = process.env.SEED_REQUIRE_SIGN_IN
  return value === '1' || value === 'true'
}
