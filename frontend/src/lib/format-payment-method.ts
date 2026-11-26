/**
 * Shared payment method & ledger description formatters.
 *
 * Canonical backend method codes (`cash`, `upi`, `credit_card`, `debit_card`,
 * `bank_transfer`, `other`, plus legacy `card`, `net_banking`, `manual`) do
 * NOT match the camelCase i18n keys in `money.*` (`creditCard`, `debitCard`,
 * `bankTransfer`, `otherMethod`). Centralizing this mapping prevents raw i18n
 * keys like `money.credit_card` or raw snake_case strings from ever leaking
 * into UI tables, vouchers, or ledgers.
 */
import { formatStatus } from "@/lib/format-status";

export const PAYMENT_METHOD_I18N_KEY: Record<string, string> = {
  cash: "cash",
  upi: "upi",
  card: "card",
  credit_card: "creditCard",
  debit_card: "debitCard",
  bank_transfer: "bankTransfer",
  net_banking: "bankTransfer",
  other: "otherMethod",
  manual: "otherMethod",
};

const PURPOSE_I18N_KEY: Record<string, string> = {
  advance: "purpose_advance",
  stay: "purpose_stay",
  deposit: "purpose_deposit",
  charge: "purpose_charge",
  other: "purpose_other",
};

const METHOD_STATIC_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  bank_transfer: "Net Banking",
  net_banking: "Net Banking",
  other: "Other",
  manual: "Other",
};

/** Resolve a payment method code using a `useTranslations("money")` translator. */
export function formatPaymentMethod(
  method: string | null | undefined,
  translateMoney?: (key: string) => string,
): string {
  if (!method) return "—";
  const norm = method.trim().toLowerCase();
  const key = PAYMENT_METHOD_I18N_KEY[norm];
  if (key && translateMoney) {
    return translateMoney(key);
  }
  if (METHOD_STATIC_LABEL[norm]) {
    return METHOD_STATIC_LABEL[norm];
  }
  return formatStatus(method);
}

/**
 * Format stored ledger entry descriptions (including historical rows saved as
 * `"Payment (credit_card, advance)"` or `"Refund (bank_transfer): reason"`) so
 * raw snake_case method & purpose tokens appear as localized display labels.
 */
export function formatLedgerDescription(
  description: string | null | undefined,
  translateMoney?: (key: string) => string,
): string {
  if (!description) return "—";

  const payMatch = /^Payment \(([^,)]+),\s*([^)]+)\)$/i.exec(description.trim());
  if (payMatch) {
    const [, rawMethod, rawPurpose] = payMatch;
    const methodLabel = formatPaymentMethod(rawMethod, translateMoney);
    const pKey = PURPOSE_I18N_KEY[rawPurpose.trim().toLowerCase()];
    const purposeLabel =
      pKey && translateMoney ? translateMoney(pKey) : formatStatus(rawPurpose);
    return `Payment (${methodLabel}, ${purposeLabel})`;
  }

  const refMatch = /^Refund \(([^)]+)\):\s*(.*)$/i.exec(description.trim());
  if (refMatch) {
    const [, rawMethod, reason] = refMatch;
    const methodLabel = formatPaymentMethod(rawMethod, translateMoney);
    return `Refund (${methodLabel}): ${reason}`;
  }

  return description;
}
