export type PetAge = {
  unit: 'month' | 'year';
  value: number;
};

export function parseDateOnly(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function getPetAge(
  birthday: string | null | undefined,
  today = new Date(),
): PetAge | null {
  const birthDate = parseDateOnly(birthday);

  if (!birthDate) {
    return null;
  }

  let months =
    (today.getFullYear() - birthDate.getFullYear()) * 12 +
    today.getMonth() -
    birthDate.getMonth();

  if (today.getDate() < birthDate.getDate()) {
    months -= 1;
  }

  if (months < 0) {
    return null;
  }

  if (months >= 12) {
    return { unit: 'year', value: Math.floor(months / 12) };
  }

  return { unit: 'month', value: months };
}

export function getCompanionDays(
  adoptionDate: string | null | undefined,
  today = new Date(),
) {
  const start = parseDateOnly(adoptionDate);

  if (!start) {
    return null;
  }

  const startUtc = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const difference = Math.floor((todayUtc - startUtc) / 86_400_000);

  return difference < 0 ? null : difference + 1;
}

export function formatDateOnly(
  value: string | null | undefined,
  locale: string,
) {
  const date = parseDateOnly(value);

  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
