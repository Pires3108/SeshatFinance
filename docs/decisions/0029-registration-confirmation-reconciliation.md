# ADR-029 — Registration confirmation reconciliation

**Status:** accepted for US-013 / SESHAT-29.

## Context

Supabase consumes a confirmation OTP before the API can commit a local profile. A database failure in that interval must not grant an unlinked identity access or permanently strand a confirmed user.

## Decision

The API records a local registration intent keyed by HMAC-SHA-256 of normalized email before calling Supabase signup; it stores no email or name in the intent. Once signup returns a real provider identity, it creates a pending profile keyed by the immutable provider UUID. A duplicate or rejected provider signup does not create a profile. Confirmation checks database readiness before consuming the OTP, verifies the provider identity, and commits the profile confirmation and intent removal in one transaction. Repeated linking is idempotent.

The API bearer boundary requires both a provider-confirmed email and a local profile. If confirmation succeeded at Supabase but the local transaction failed, a later provider-authenticated request reconciles the matching intent using the immutable provider UUID and confirmed email. A pending profile alone grants no access. The browser opaque-session login path must apply the same profile requirement when it is integrated from US-014.

The Supabase Confirm signup email template must point directly to the app callback using `<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Confirm email</a>`. The fragment keeps the token out of HTTP request URLs and referer headers; the callback removes it from browser history before posting it to the API. The default `{{ .ConfirmationURL }}` consumes the OTP at Supabase before this API can link the local profile. Set `AUTH_CONFIRMATION_REDIRECT_URL` to the allowlisted `/confirmar-email` URL without a fragment. See [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Consequences

Registration intents expire after seven days, longer than Supabase's [recommended maximum one-day confirmation OTP lifetime](https://supabase.com/docs/guides/auth/auth-email-passwordless). The API prunes expired intents at startup and hourly. Deployment must keep the provider's configured OTP lifetime at or below seven days. Recovery requires a valid provider-authenticated request; a consumed OTP is never accepted as proof on retry. Browser login integration is a dependency of US-014 and must enforce the local profile gate before issuing a session.

Generate `AUTH_REGISTRATION_INTENT_HMAC_KEY` from 32 random bytes encoded as base64url and keep it only in the server secret store. For planned rotation, stop issuing new registration intents, keep the current key for seven days while existing intents drain, then switch to the replacement key and resume registration. An immediate emergency switch invalidates lookup for unmatched intents, though already-created pending profiles remain identifiable by provider UUID.

For local setup, generate a key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and place it in an untracked environment file. The value in `.env.example` is a placeholder and deliberately fails validation.
