import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('public journey accessibility', () => {
  it('declares Portuguese as the document language', () => {
    expect(source('./layout.tsx')).toContain('<html lang="pt-BR">');
  });

  it.each(['cadastro/page.tsx', 'recuperar-senha/page.tsx'])(
    'provides a skip link and keyboard focusable main for %s',
    (page) => {
      const content = source(`./${page}`);

      expect(content).toContain('className="skip-link" href="#main-content"');
      expect(content).toContain('id="main-content" tabIndex={-1}');
      expect(content).toContain('<h1 id="page-title">');
    },
  );

  it('associates each public form field with a visible label', () => {
    const registration = source('./cadastro/registration-form.tsx');
    const recovery = source('./recuperar-senha/password-recovery-form.tsx');

    expect(registration).toContain(
      '<label htmlFor="display-name">Nome</label>',
    );
    expect(registration).toContain('<label htmlFor="email">E-mail</label>');
    expect(registration).toContain('<label htmlFor="password">Senha</label>');
    expect(recovery).toContain(
      '<label htmlFor="recovery-email">E-mail</label>',
    );
  });

  it('keeps announced form states and the offline landmark', () => {
    const registration = source('./cadastro/registration-form.tsx');
    const recovery = source('./recuperar-senha/password-recovery-form.tsx');
    const offline = source('./offline/page.tsx');

    expect(registration).toContain('role="status"');
    expect(registration).toContain('role="alert"');
    expect(recovery).toContain('role="status"');
    expect(recovery).toContain('role="alert"');
    expect(offline).toContain('<main className="offline-page"');
    expect(offline).toContain('id="main-content" tabIndex={-1}');
  });
});
