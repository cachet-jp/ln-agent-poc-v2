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
  cardNumber: string;
  securityCode: string;
  amount: number;
  expiryDate?: string;
}

/** Amazon purchase result */
export interface AmazonPurchaseResult {
  orderId: string;
  itemName: string;
  totalAmount: string;
}
