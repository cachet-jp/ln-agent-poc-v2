/** Ark wallet balance */
export interface ArkBalance {
  /** Off-chain (vTXO) balance in sats */
  offchain: number;
  /** On-chain balance in sats */
  onchain: number;
}

/** Ark receive addresses */
export interface ArkAddresses {
  /** Ark off-chain address */
  arkAddress: string;
  /** On-chain boarding address */
  boardingAddress: string;
}

/** Lightning payment result */
export interface PayInvoiceResult {
  success: boolean;
  preimage?: string;
  error?: string;
}

/** V-Preca gift code from UseBitcoin */
export interface VPrecaCode {
  /** Voucher code (alphanumeric, e.g. "GkMPMzZcAHus4F1") */
  voucherCode: string;
  /** Last 4 digits of the card number */
  cardLast4: string;
  /** Amount in JPY */
  amount: number;
  /** @deprecated Use voucherCode instead */
  cardNumber: string;
  /** @deprecated Use cardLast4 instead */
  securityCode: string;
  expiryDate?: string;
}

/** Amazon purchase result */
export interface AmazonPurchaseResult {
  orderId: string;
  itemName: string;
  totalAmount: string;
}

/** Amazon account creation page states */
export type AmazonPageState =
  | "registration_form"
  | "captcha"
  | "puzzle"
  | "email_otp"
  | "sms_otp"
  | "success"
  | "error"
  | "unknown";

/** Result returned by Amazon account creation flow tools */
export interface AmazonAccountFlowResult {
  step: AmazonPageState;
  message: string;
  credentials?: { email: string; password: string };
}
