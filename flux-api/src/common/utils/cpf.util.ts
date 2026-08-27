export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

export function formatCpf(cpf: string): string {
  const digits = normalizeCpf(cpf);
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpf(cpf);

  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  check = (sum * 10) % 11;
  if (check === 10) check = 0;

  return check === Number(digits[10]);
}
