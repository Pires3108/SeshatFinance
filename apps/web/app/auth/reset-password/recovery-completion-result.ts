export const RECOVERY_UNAVAILABLE = {
  message:
    'Não foi possível confirmar a redefinição da senha. O link pode ter sido usado.',
  action: 'Solicitar um novo link',
  actionHref: '/recuperar-senha',
} as const;

export function completionResult(
  status: number,
): 'success' | 'invalid' | 'unavailable' {
  if (status === 204) return 'success';
  if (status === 400) return 'invalid';
  return 'unavailable';
}
