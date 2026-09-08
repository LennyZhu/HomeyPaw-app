const leadingInvisibleCharacters = /^[\s\u200B-\u200D\u2060\uFEFF]+/u;

export function getUserAvatarInitial(name: string | null | undefined) {
  const normalizedName = name?.trim().replace(leadingInvisibleCharacters, '');
  const firstCharacter = normalizedName ? Array.from(normalizedName)[0] : null;

  return firstCharacter?.toLocaleUpperCase() ?? '?';
}
