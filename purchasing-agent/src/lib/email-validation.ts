/**
 * Disposable email domain detection.
 *
 * Checks whether a given email address belongs to a known disposable / throwaway
 * mail provider that Amazon is likely to block on registration.
 */

const KNOWN_DISPOSABLE_DOMAINS: readonly string[] = [
  "keemail.me",
  "guerrillamail.com",
  "guerrillamail.de",
  "tempmail.com",
  "mailinator.com",
  "throwaway.email",
  "yopmail.com",
  "sharklasers.com",
  "grr.la",
  "guerrillamail.info",
  "temp-mail.org",
  "fakeinbox.com",
  "dispostable.com",
  "maildrop.cc",
  "trashmail.com",
  "10minutemail.com",
];

export interface DisposableEmailWarning {
  isDisposable: true;
  domain: string;
  message: string;
}

/**
 * Returns a warning object if the email belongs to a known disposable domain,
 * or `null` if the email is acceptable.
 */
export function checkDisposableEmail(
  email: string,
): DisposableEmailWarning | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  if (!KNOWN_DISPOSABLE_DOMAINS.includes(domain)) {
    return null;
  }

  return {
    isDisposable: true,
    domain,
    message: [
      `⚠️ 使い捨てメールドメイン "${domain}" が検出されました。`,
      "Amazon はこれらのドメインからの登録を即座にBANする可能性が高いです。",
      "",
      "推奨: Gmail, Yahoo, iCloud, Outlook 等の正規プロバイダを使用してください。",
      "",
      "このまま続行する場合は、別のメールアドレスで再度呼び出してください。",
    ].join("\n"),
  };
}
