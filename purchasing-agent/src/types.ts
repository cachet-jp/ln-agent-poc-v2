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

// ---------------------------------------------------------------------------
// Generic gift card types (UseBitcoin multi-product support)
// ---------------------------------------------------------------------------

/** Supported product types on UseBitcoin.jp */
export type UseBitcoinProduct = "vpreca" | "kyash" | "quocard" | "aupay" | "dmm" | "bitcash";

/** Product catalog entry */
export interface ProductCatalog {
  /** Display name */
  name: string;
  /** URL slug for the product category */
  slug: string;
  /** URL slug prefix for the SKU (e.g. "vpreca" → /vpreca-1000) */
  skuPrefix: string;
  /** Valid JPY denominations */
  amounts: number[];
  /** Description of the gift card */
  description: string;
}

/** Generic gift card purchase result */
export interface GiftCardResult {
  /** Product type */
  product: UseBitcoinProduct;
  /** Primary gift code */
  code: string;
  /** Secondary code (e.g. V-Preca card last 4, security code) */
  secondaryCode?: string;
  /** Amount in JPY */
  amount: number;
  /** UseBitcoin order ID */
  orderId: string;
  /** Lightning payment preimage */
  preimage: string;
  /** Payment method used */
  paymentMethod: "cashu" | "ark" | "auto";
  /** Sats paid */
  satsPaid: number;
  /** Fee in sats */
  fee?: number;
  /** Expiry date if applicable */
  expiryDate?: string;
}

/** Amazon purchase result */
export interface AmazonPurchaseResult {
  orderId: string;
  itemName: string;
  totalAmount: string;
}
