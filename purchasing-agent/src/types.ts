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
  paymentMethod: "cashu";
  /** Sats paid */
  satsPaid: number;
  /** Fee in sats */
  fee?: number;
  /** Expiry date if applicable */
  expiryDate?: string;
}

/** V-Preca card details retrieved from Lifecard inquiry page */
export interface VPrecaCardDetails {
  /** Full 16-digit card number */
  cardNumber: string;
  /** Expiry date (MM/YY) */
  expiryDate: string;
  /** Security code (CVV, 3 digits) */
  securityCode: string;
  /** Remaining balance in JPY */
  balance: number;
  /** Card name if displayed */
  cardName?: string;
}

// ---------------------------------------------------------------------------
// Bitrefill types
// ---------------------------------------------------------------------------

/** Bitrefill product from search results */
export interface BitrefillProduct {
  /** Product identifier */
  id: string;
  /** Display name */
  name: string;
  /** ISO country code */
  country: string;
  /** Currency code (e.g. "JPY", "USD") */
  currency: string;
  /** Product category */
  category: string;
  /** Variable-price range (if applicable) */
  range?: { min: number; max: number };
  /** Fixed denomination packages */
  packages?: { value: number; satoshiPrice: number }[];
}

/** Bitrefill product detail (extended info) */
export interface BitrefillProductDetail extends BitrefillProduct {
  /** Long description */
  description?: string;
  /** Redemption instructions */
  redemptionInstructions?: string;
  /** Image URL */
  image?: string;
}

/** Bitrefill invoice returned by create_invoice */
export interface BitrefillInvoice {
  /** Invoice ID */
  id: string;
  /** Associated order ID */
  orderId?: string;
  /** Lightning BOLT11 invoice string */
  lightningInvoice?: string;
  /** Bitcoin on-chain URI */
  bitcoinUri?: string;
  /** Price in satoshis */
  satoshiPrice: number;
  /** Invoice status */
  status: string;
  /** Payment method */
  paymentMethod: string;
}

/** Bitrefill order with redeemable codes */
export interface BitrefillOrder {
  /** Order ID */
  id: string;
  /** Order status */
  status: string;
  /** Ordered items */
  items: BitrefillOrderItem[];
}

/** Single item in a Bitrefill order */
export interface BitrefillOrderItem {
  /** Product ID */
  productId: string;
  /** Product name */
  productName: string;
  /** Redemption code (after unseal) */
  code?: string;
  /** PIN (after unseal, if applicable) */
  pin?: string;
  /** Value/denomination */
  value?: number;
  /** Currency */
  currency?: string;
}

/** Result from bitrefill_buy tool */
export interface BitrefillPurchaseResult {
  /** Provider identifier */
  provider: "bitrefill";
  /** Bitrefill product ID */
  productId: string;
  /** Product name */
  productName: string;
  /** Primary redemption code */
  code: string;
  /** PIN if applicable */
  pin?: string;
  /** Bitrefill order ID */
  orderId: string;
  /** Lightning payment preimage */
  preimage: string;
  /** Payment method used */
  paymentMethod: "cashu";
  /** Sats paid */
  satsPaid: number;
  /** Fee in sats */
  fee?: number;
}
