# ADR-028 — Password recovery token consumption

**Status:** proposed for US-018 (SESHAT-35), 03/10/2026.

## Context

US-018 requires a generic recovery request and a link that expires and can be used once. The existing request delegates email delivery to Supabase Auth. The API is the server boundary for completing the password change; the browser must not receive a Supabase session.

## Implementation

The reset email must use a custom Supabase **Reset password** template with a direct link to the configured `AUTH_PASSWORD_RECOVERY_REDIRECT_URL`:

```html
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Redefinir senha</a>
```

The URL fragment keeps the token out of the page request and removes it from the address bar before the form is submitted. The web proxy sends the token hash and new password to the API in a request body. The API calls `verifyOtp` with type `recovery`, then `updateUser` on that same request-scoped Supabase client. A failed, consumed, or expired token yields one generic error; no Supabase session is returned to the browser.

Supabase's **Email OTP expiration** setting controls recovery-link lifetime. The product has not yet recorded an explicit lifetime for recovery links, so the deployed setting must be checked and an accepted value documented before US-018 is Done. A real provider integration test must demonstrate first use, replay rejection, and expiry using the configured value. Mocked adapter tests do not establish these provider guarantees. Provider outages return a retryable response without exposing provider details; expired or consumed links return a generic invalid-link response.

## References

- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase password reset](https://supabase.com/docs/guides/auth/passwords#resetting-a-password)
- [Supabase email OTP expiration](https://supabase.com/docs/guides/auth/auth-email-passwordless)
