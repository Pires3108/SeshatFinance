import type { ReactNode } from 'react';

import { ResetPasswordForm } from './reset-password-form';

export default function ResetPasswordPage(): ReactNode {
  return (
    <main id="main-content" className="auth-page">
      <section className="auth-shell">
        <h1 id="page-title">Redefinir senha</h1>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
