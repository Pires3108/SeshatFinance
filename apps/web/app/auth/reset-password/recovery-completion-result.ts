export const RECOVERY_UNAVAILABLE = {
  message:
    'Não foi possível confirmar a redefinição da senha. O link pode ter sido usado.',
  action: 'Solicitar um novo link',
  actionHref: '/recuperar-senha',
} as const;

export const RECOVERY_PASSWORD_REJECTED = {
  message:
    'Esta senha não pode ser usada. Escolha outra senha com pelo menos 12 caracteres e solicite um novo link.',
  action: 'Solicitar um novo link',
  actionHref: '/recuperar-senha',
} as const;

export function completionResult(
  status: number,
  errorCode?: string,
):
  | 'success'
  | 'invalid'
  | 'password-invalid'
  | 'password-rejected'
  | 'unavailable' {
  if (status === 204) return 'success';
  if (status === 400) return 'invalid';
  if (status === 422 && errorCode === 'password_invalid')
    return 'password-invalid';
  if (status === 422) return 'password-rejected';
  return 'unavailable';
}
