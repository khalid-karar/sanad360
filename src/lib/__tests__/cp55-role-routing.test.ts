/**
 * CP5.5: an applicant (every tenant ID NULL) must land on the dedicated
 * application-status screen, never a tenant dashboard. Before this fix,
 * homeRouteFor's final fallback (`user.transport_company_id ? '/transport'
 * : '/company'`) silently routed an unrecognized role — including the new
 * 'applicant' role — into '/company', which would have shown a company
 * dashboard to a user with no company_id at all. Pure-function test, no DB
 * needed.
 */
import { describe, it, expect } from 'vitest';
import { homeRouteFor } from '../roleRouting';

describe('CP5.5 roleRouting: applicant', () => {
  it('routes an applicant to /application-status, not a tenant dashboard', () => {
    expect(homeRouteFor({ role: 'applicant', transport_company_id: null })).toBe('/application-status');
  });

  it('does not fall through to /company or /transport even if transport_company_id were somehow set', () => {
    // Defense-in-depth: the one_tenant CHECK (migration 035) guarantees this
    // never happens in the DB, but the routing function itself must not
    // rely on that invariant to stay safe.
    expect(homeRouteFor({ role: 'applicant', transport_company_id: 'some-id' })).toBe('/application-status');
  });

  it('every other existing role is unaffected by the new applicant branch', () => {
    expect(homeRouteFor({ role: 'owner', transport_company_id: null })).toBe('/company');
    expect(homeRouteFor({ role: 'owner', transport_company_id: 'tc-1' })).toBe('/transport');
    expect(homeRouteFor({ role: 'document_reviewer', transport_company_id: null })).toBe('/reviewer');
    expect(homeRouteFor({ role: 'admin', transport_company_id: null })).toBe('/admin');
  });
});
